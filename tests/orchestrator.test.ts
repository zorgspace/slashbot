import { describe, expect, test, vi, beforeEach } from 'vitest';
import type { JsonValue, PluginRegistrationContext, ToolDefinition } from '../src/core/kernel/contracts.js';
import type { AgentLoopResult } from '../src/core/agentic/llm/index.js';
import type { LlmCompletionInput } from '../src/core/agentic/llm/index.js';

// ---------------------------------------------------------------------------
// Mock KernelLlmAdapter — intercept before the plugin imports it
// ---------------------------------------------------------------------------

const mockComplete = vi.fn<(input: LlmCompletionInput) => Promise<AgentLoopResult>>();

vi.mock('../src/core/agentic/llm/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/core/agentic/llm/index.js')>();
  return {
    ...original,
    KernelLlmAdapter: vi.fn().mockImplementation(() => ({
      complete: mockComplete,
    })),
  };
});

// Import AFTER mock is in place
const { createOrchestratorPlugin, RunRegistry } = await import('../src/plugins/orchestrator/index.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function noopLogger() {
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
}

function fakeAgentResult(text: string, overrides?: Partial<AgentLoopResult>): AgentLoopResult {
  return {
    text,
    steps: 1,
    toolCalls: 0,
    finishReason: 'end_turn',
    ...overrides,
  };
}

function makeAgent(id: string, name: string, role: string, opts?: { enabled?: boolean; provider?: string; model?: string; systemPrompt?: string; toolAllowlist?: string[] }) {
  const now = new Date().toISOString();
  return {
    id,
    name,
    role,
    systemPrompt: opts?.systemPrompt ?? '',
    provider: opts?.provider,
    model: opts?.model,
    enabled: opts?.enabled ?? true,
    toolAllowlist: opts?.toolAllowlist,
    createdAt: now,
    updatedAt: now,
  };
}

class MockAgentRegistry {
  private agents = new Map<string, ReturnType<typeof makeAgent>>();

  add(agent: ReturnType<typeof makeAgent>) {
    this.agents.set(agent.id, agent);
  }

  get(id: string) {
    return this.agents.get(id);
  }

  list() {
    return [...this.agents.values()];
  }

  listTeams() {
    return [];
  }
}

interface Harness {
  tools: Map<string, ToolDefinition>;
  contexts: Map<string, { provide: () => Promise<string> | string }>;
  services: Map<string, unknown>;
  registry: MockAgentRegistry;
  events: { publish: ReturnType<typeof vi.fn> };
}

function setupPlugin(registryOverride?: MockAgentRegistry): Harness {
  const plugin = createOrchestratorPlugin();
  const tools = new Map<string, ToolDefinition>();
  const contexts = new Map<string, { provide: () => Promise<string> | string }>();
  const services = new Map<string, unknown>();
  const registry = registryOverride ?? new MockAgentRegistry();

  const stubEvents = {
    publish: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    subscribeAll: vi.fn(() => () => {}),
  };

  const stubKernel = {
    assemblePrompt: async () => 'You are a helpful assistant.',
    events: stubEvents,
  };

  plugin.setup({
    registerTool: (tool) => { tools.set(tool.id, tool as ToolDefinition); },
    registerCommand: () => undefined,
    registerService: (svc) => { services.set((svc as { id: string }).id, (svc as { implementation: unknown }).implementation); },
    registerHook: () => undefined,
    registerProvider: () => undefined,
    registerGatewayMethod: () => undefined,
    registerHttpRoute: () => undefined,
    registerChannel: () => undefined,
    contributePromptSection: () => undefined,
    contributeContextProvider: (provider) => { contexts.set(provider.id, { provide: provider.provide }); },
    contributeStatusIndicator: () => (() => {}) as never,
    getService: <TService,>(serviceId: string) => {
      if (serviceId === 'kernel.instance') return stubKernel as TService;
      if (serviceId === 'kernel.authRouter') return {} as TService;
      if (serviceId === 'kernel.providers.registry') return {} as TService;
      if (serviceId === 'kernel.logger') return noopLogger() as TService;
      if (serviceId === 'agents.registry') return registry as TService;
      return undefined;
    },
    dispatchHook: async (_domain, _event, payload) => ({
      initialPayload: payload,
      finalPayload: payload,
      failures: [],
    }),
    logger: noopLogger(),
  } as PluginRegistrationContext);

  return { tools, contexts, services, registry, events: stubEvents };
}

async function executeTool(harness: Harness, toolId: string, args: Record<string, JsonValue>) {
  const tool = harness.tools.get(toolId)!;
  return tool.execute(args as JsonValue, {});
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('orchestrator plugin', () => {
  beforeEach(() => {
    mockComplete.mockReset();
  });

  // ── Manifest & registration ──────────────────────────────────────

  describe('manifest', () => {
    test('has correct id and dependencies', () => {
      const plugin = createOrchestratorPlugin();
      expect(plugin.manifest.id).toBe('slashbot.orchestrator');
      expect(plugin.manifest.dependencies).toContain('slashbot.agents');
      expect(plugin.manifest.dependencies).toContain('slashbot.providers.auth');
    });

    test('registers orchestrate, orchestrate.list, and orchestrate.kill tools', () => {
      const harness = setupPlugin();
      expect(harness.tools.has('orchestrate')).toBe(true);
      expect(harness.tools.has('orchestrate.list')).toBe(true);
      expect(harness.tools.has('orchestrate.kill')).toBe(true);
    });

    test('registers run registry as a service', () => {
      const harness = setupPlugin();
      expect(harness.services.has('orchestrator.runs')).toBe(true);
    });

    test('registers the context provider', () => {
      const harness = setupPlugin();
      expect(harness.contexts.has('orchestrator.usage')).toBe(true);
    });
  });

  // ── Context provider ─────────────────────────────────────────────

  describe('context provider', () => {
    test('returns empty string when no agents are registered', () => {
      const harness = setupPlugin();
      const text = harness.contexts.get('orchestrator.usage')!.provide();
      expect(text).toBe('');
    });

    test('returns usage instructions when agents exist', () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Web research'));
      const harness = setupPlugin(registry);
      const text = harness.contexts.get('orchestrator.usage')!.provide() as string;
      expect(text).toContain('## Orchestrator');
      expect(text).toContain('auto');
      expect(text).toContain('fan-out');
      expect(text).toContain('pipeline');
      expect(text).toContain('background');
      expect(text).toContain('orchestrate.list');
      expect(text).toContain('orchestrate.kill');
    });

    test('ignores disabled agents', () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('disabled-agent', 'Disabled', 'Nothing', { enabled: false }));
      const harness = setupPlugin(registry);
      const text = harness.contexts.get('orchestrator.usage')!.provide();
      expect(text).toBe('');
    });
  });

  // ── Auto strategy ────────────────────────────────────────────────

  describe('auto strategy', () => {
    test('routes to explicit single agent and returns runId', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Web research'));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('Research results here'));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Find info about AI',
        strategy: 'auto',
        agents: ['researcher'],
      });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(output.strategy).toBe('auto');
      expect(output.routed).toBe('researcher');
      expect(output.text).toBe('Research results here');
      expect(typeof output.runId).toBe('string');
    });

    test('uses LLM routing when no agents specified', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Web research'));
      registry.add(makeAgent('coder', 'Coder', 'Code specialist'));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('researcher'));
      mockComplete.mockResolvedValueOnce(fakeAgentResult('Found some AI news'));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', { task: 'Search for AI news' });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(output.routed).toBe('researcher');
      expect(output.text).toBe('Found some AI news');

      const routingCall = mockComplete.mock.calls[0][0];
      expect(routingCall.noTools).toBe(true);
      expect(routingCall.maxTokens).toBe(50);
    });

    test('falls back to spawn when routing returns "none"', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('coder', 'Coder', 'Code specialist'));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('none'));
      mockComplete.mockResolvedValueOnce(fakeAgentResult('Generic spawn result'));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', { task: 'Tell me a joke' });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(output.routed).toBe('_spawn');
    });

    test('falls back to spawn when no agents registered', async () => {
      mockComplete.mockResolvedValueOnce(fakeAgentResult('Spawn did the work'));

      const harness = setupPlugin();
      const result = await executeTool(harness, 'orchestrate', { task: 'Do something' });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(output.routed).toBe('_spawn');
    });

    test('falls back to spawn when routing LLM throws', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('coder', 'Coder', 'Code'));

      mockComplete.mockRejectedValueOnce(new Error('LLM timeout'));
      mockComplete.mockResolvedValueOnce(fakeAgentResult('Spawn recovered'));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', { task: 'Do something' });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(output.routed).toBe('_spawn');
    });

    test('validates routed agent ID actually exists', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('coder', 'Coder', 'Code'));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('nonexistent'));
      mockComplete.mockResolvedValueOnce(fakeAgentResult('Spawn handled it'));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', { task: 'Something' });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(output.routed).toBe('_spawn');
    });

    test('injects extra context into agent prompt', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Research'));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('Done with context'));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', {
        task: 'Find info',
        agents: ['researcher'],
        context: 'Focus on 2024 data',
      });

      const agentCall = mockComplete.mock.calls[0][0];
      const userMsg = agentCall.messages.find((m: { role: string }) => m.role === 'user');
      expect(userMsg?.content).toContain('Focus on 2024 data');
      expect(userMsg?.content).toContain('## Additional Context');
    });

    test('includes agent systemPrompt in system message', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Research', {
        systemPrompt: 'Always cite sources.',
      }));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('Result'));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', { task: 'Find info', agents: ['researcher'] });

      const agentCall = mockComplete.mock.calls[0][0];
      const sysMsg = agentCall.messages.find((m: { role: string }) => m.role === 'system');
      expect(sysMsg?.content).toContain('Agent Instructions (Researcher)');
      expect(sysMsg?.content).toContain('Always cite sources.');
    });

    test('pins provider and model from agent spec', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Research', {
        provider: 'openai',
        model: 'gpt-4o',
      }));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('Done'));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', { task: 'Go', agents: ['researcher'] });

      const call = mockComplete.mock.calls[0][0];
      expect(call.pinnedProviderId).toBe('openai');
      expect(call.pinnedModelId).toBe('gpt-4o');
    });

    test('passes toolAllowlist from agent spec', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Research', {
        toolAllowlist: ['web.search', 'web.fetch'],
      }));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('Done'));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', { task: 'Go', agents: ['researcher'] });

      const call = mockComplete.mock.calls[0][0];
      expect(call.toolAllowlist).toEqual(['web.search', 'web.fetch']);
    });

    test('picks first enabled agent from multiple with auto', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('disabled-one', 'Dis', 'Off', { enabled: false }));
      registry.add(makeAgent('coder', 'Coder', 'Code'));
      registry.add(makeAgent('researcher', 'Researcher', 'Research'));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('Coder did it'));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Do it',
        agents: ['disabled-one', 'coder', 'researcher'],
      });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(output.routed).toBe('coder');
    });
  });

  // ── Fan-out strategy ─────────────────────────────────────────────

  describe('fan-out strategy', () => {
    test('runs task across multiple agents in parallel', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Research'));
      registry.add(makeAgent('coder', 'Coder', 'Code'));

      mockComplete.mockImplementation(async (input: LlmCompletionInput) => {
        if (input.agentId === 'researcher') return fakeAgentResult('Research output');
        if (input.agentId === 'coder') return fakeAgentResult('Code output');
        return fakeAgentResult('Unknown');
      });

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Summarize AI',
        strategy: 'fan-out',
        agents: ['researcher', 'coder'],
      });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(output.strategy).toBe('fan-out');

      const results = output.results as Array<Record<string, JsonValue>>;
      expect(results).toHaveLength(2);
      expect(results[0].agentId).toBe('researcher');
      expect(results[0].text).toBe('Research output');
      expect(results[1].agentId).toBe('coder');
      expect(results[1].text).toBe('Code output');
    });

    test('resolves all enabled agents when none specified', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Research'));
      registry.add(makeAgent('coder', 'Coder', 'Code'));
      registry.add(makeAgent('disabled', 'Disabled', 'Off', { enabled: false }));

      mockComplete.mockResolvedValue(fakeAgentResult('Output'));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Do stuff',
        strategy: 'fan-out',
      });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      const results = output.results as Array<Record<string, JsonValue>>;
      expect(results).toHaveLength(2);
      expect(results.map((r) => r.agentId)).toEqual(['researcher', 'coder']);
    });

    test('fails with < 2 agents explicitly provided', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Research'));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Do stuff',
        strategy: 'fan-out',
        agents: ['researcher'],
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    test('fails with empty registry and no agents', async () => {
      const harness = setupPlugin();
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Do stuff',
        strategy: 'fan-out',
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    test('catches per-agent errors gracefully', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Research'));
      registry.add(makeAgent('broken', 'Broken', 'Always fails'));

      mockComplete.mockImplementation(async (input: LlmCompletionInput) => {
        if (input.agentId === 'broken') throw new Error('Agent crashed');
        return fakeAgentResult('Research output');
      });

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Try both',
        strategy: 'fan-out',
        agents: ['researcher', 'broken'],
      });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      const results = output.results as Array<Record<string, JsonValue>>;
      expect(results[0].text).toBe('Research output');
      expect(results[1].text).toContain('Error:');
      expect(results[1].text).toContain('Agent crashed');
      expect(results[1].finishReason).toBe('error');
    });
  });

  // ── Pipeline strategy ────────────────────────────────────────────

  describe('pipeline strategy', () => {
    test('chains agents sequentially with output forwarding', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Research'));
      registry.add(makeAgent('writer', 'Writer', 'Writing'));

      const callOrder: string[] = [];
      mockComplete.mockImplementation(async (input: LlmCompletionInput) => {
        callOrder.push(input.agentId);
        if (input.agentId === 'researcher') return fakeAgentResult('Raw research data');
        if (input.agentId === 'writer') return fakeAgentResult('Polished article');
        return fakeAgentResult('?');
      });

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Research then write about AI',
        strategy: 'pipeline',
        agents: ['researcher', 'writer'],
      });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(output.strategy).toBe('pipeline');
      expect(output.finalAgent).toBe('writer');
      expect(output.text).toBe('Polished article');
      expect(callOrder).toEqual(['researcher', 'writer']);

      const writerCall = mockComplete.mock.calls[1][0];
      const writerUser = writerCall.messages.find((m: { role: string }) => m.role === 'user');
      expect(writerUser?.content).toContain('## Previous Agent Output');
      expect(writerUser?.content).toContain('Raw research data');

      const chain = output.chain as Array<Record<string, JsonValue>>;
      expect(chain).toHaveLength(2);
      expect(chain[0].agentId).toBe('researcher');
      expect(chain[1].agentId).toBe('writer');
    });

    test('resolves all enabled agents when none specified', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('step1', 'Step 1', 'First'));
      registry.add(makeAgent('step2', 'Step 2', 'Second'));

      mockComplete.mockResolvedValue(fakeAgentResult('Output'));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Run pipeline',
        strategy: 'pipeline',
      });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      const chain = output.chain as Array<Record<string, JsonValue>>;
      expect(chain).toHaveLength(2);
    });

    test('fails with < 2 agents', async () => {
      const harness = setupPlugin();
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Pipeline',
        strategy: 'pipeline',
        agents: ['only-one'],
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('VALIDATION_ERROR');
    });

    test('three-stage pipeline threads context correctly', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'First'));
      registry.add(makeAgent('b', 'B', 'Second'));
      registry.add(makeAgent('c', 'C', 'Third'));

      mockComplete.mockImplementation(async (input: LlmCompletionInput) => {
        if (input.agentId === 'a') return fakeAgentResult('Output A');
        if (input.agentId === 'b') return fakeAgentResult('Output B');
        if (input.agentId === 'c') return fakeAgentResult('Output C');
        return fakeAgentResult('?');
      });

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Three stages',
        strategy: 'pipeline',
        agents: ['a', 'b', 'c'],
      });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(output.text).toBe('Output C');

      const callA = mockComplete.mock.calls[0][0];
      const userA = callA.messages.find((m: { role: string }) => m.role === 'user');
      expect(userA?.content).not.toContain('## Previous Agent Output');

      const callB = mockComplete.mock.calls[1][0];
      const userB = callB.messages.find((m: { role: string }) => m.role === 'user');
      expect(userB?.content).toContain('Output A');

      const callC = mockComplete.mock.calls[2][0];
      const userC = callC.messages.find((m: { role: string }) => m.role === 'user');
      expect(userC?.content).toContain('Output B');
    });

    test('pipeline propagates mid-chain error', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'First'));
      registry.add(makeAgent('b', 'B', 'Second'));

      mockComplete.mockImplementation(async (input: LlmCompletionInput) => {
        if (input.agentId === 'b') throw new Error('B exploded');
        return fakeAgentResult('A output');
      });

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Pipeline',
        strategy: 'pipeline',
        agents: ['a', 'b'],
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('ORCHESTRATE_ERROR');
      expect(result.error?.message).toContain('B exploded');
    });
  });

  // ── Background mode ──────────────────────────────────────────────

  describe('background mode', () => {
    test('returns immediately with runId when background=true', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('researcher', 'Researcher', 'Research'));

      let resolveComplete!: (v: AgentLoopResult) => void;
      mockComplete.mockImplementationOnce(() => new Promise((r) => { resolveComplete = r; }));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Background task',
        agents: ['researcher'],
        background: true,
        label: 'bg-research',
      });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(output.status).toBe('accepted');
      expect(typeof output.runId).toBe('string');
      expect(output.label).toBe('bg-research');

      // Run is still active
      const listResult = await executeTool(harness, 'orchestrate.list', { active: true });
      const runs = listResult.output as Array<Record<string, JsonValue>>;
      expect(runs.length).toBeGreaterThanOrEqual(1);
      const activeRun = runs.find((r) => r.runId === output.runId);
      expect(activeRun).toBeDefined();
      expect(activeRun!.status === 'pending' || activeRun!.status === 'running').toBe(true);

      // Complete the background task
      resolveComplete(fakeAgentResult('Background result'));
      await delay(10);

      // Run should be completed now
      const listResult2 = await executeTool(harness, 'orchestrate.list', {});
      const runs2 = listResult2.output as Array<Record<string, JsonValue>>;
      const completedRun = runs2.find((r) => r.runId === output.runId);
      expect(completedRun).toBeDefined();
      expect(completedRun!.status).toBe('completed');
    });

    test('publishes orchestrate:spawned event', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      mockComplete.mockResolvedValue(fakeAgentResult('Done'));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', {
        task: 'Go',
        agents: ['a'],
        background: true,
        label: 'test-spawn',
      });
      await delay(10);

      const spawnedCalls = harness.events.publish.mock.calls.filter(
        (c: unknown[]) => c[0] === 'orchestrate:spawned',
      );
      expect(spawnedCalls.length).toBe(1);
      expect(spawnedCalls[0][1].label).toBe('test-spawn');
      expect(spawnedCalls[0][1].background).toBe(true);
    });

    test('background error sets status to error', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      mockComplete.mockRejectedValueOnce(new Error('Boom'));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Fail bg',
        agents: ['a'],
        background: true,
      });
      await delay(10);

      const output = result.output as Record<string, JsonValue>;
      const listResult = await executeTool(harness, 'orchestrate.list', {});
      const runs = listResult.output as Array<Record<string, JsonValue>>;
      const failedRun = runs.find((r) => r.runId === output.runId);
      expect(failedRun).toBeDefined();
      expect(failedRun!.status).toBe('error');
    });
  });

  // ── Label support ────────────────────────────────────────────────

  describe('label support', () => {
    test('uses custom label when provided', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('Done'));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', {
        task: 'Go',
        agents: ['a'],
        label: 'my-custom-label',
      });

      const listResult = await executeTool(harness, 'orchestrate.list', {});
      const runs = listResult.output as Array<Record<string, JsonValue>>;
      expect(runs.some((r) => r.label === 'my-custom-label')).toBe(true);
    });

    test('auto-generates label when not provided', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('Done'));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', {
        task: 'Go',
        agents: ['a'],
      });

      const listResult = await executeTool(harness, 'orchestrate.list', {});
      const runs = listResult.output as Array<Record<string, JsonValue>>;
      expect(runs.length).toBe(1);
      expect(typeof runs[0].label).toBe('string');
      expect((runs[0].label as string).startsWith('auto-')).toBe(true);
    });
  });

  // ── Concurrency limits ───────────────────────────────────────────

  describe('concurrency limits', () => {
    test('rejects when max concurrent reached', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      // Never resolves — keeps runs active
      mockComplete.mockImplementation(() => new Promise(() => {}));

      const harness = setupPlugin(registry);
      const runReg = harness.services.get('orchestrator.runs') as InstanceType<typeof RunRegistry>;
      runReg.maxConcurrent = 2;

      // Fill up the concurrency slots
      await executeTool(harness, 'orchestrate', { task: 'bg1', agents: ['a'], background: true });
      await executeTool(harness, 'orchestrate', { task: 'bg2', agents: ['a'], background: true });

      // Third should be rejected
      const result = await executeTool(harness, 'orchestrate', {
        task: 'bg3',
        agents: ['a'],
        background: true,
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('CONCURRENCY_LIMIT');
    });
  });

  // ── orchestrate.list ─────────────────────────────────────────────

  describe('orchestrate.list', () => {
    test('returns empty message when no runs', async () => {
      const harness = setupPlugin();
      const result = await executeTool(harness, 'orchestrate.list', {});
      expect(result.ok).toBe(true);
      expect(typeof result.output).toBe('string');
    });

    test('shows completed runs with result preview', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      mockComplete.mockResolvedValueOnce(fakeAgentResult('The quick brown fox'));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', {
        task: 'Do something interesting',
        agents: ['a'],
        label: 'fox-run',
      });

      const listResult = await executeTool(harness, 'orchestrate.list', {});
      const runs = listResult.output as Array<Record<string, JsonValue>>;
      expect(runs.length).toBe(1);
      expect(runs[0].label).toBe('fox-run');
      expect(runs[0].status).toBe('completed');
      expect(runs[0].resultPreview).toContain('quick brown fox');
    });

    test('active filter only shows running/pending', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      // First: completes
      mockComplete.mockResolvedValueOnce(fakeAgentResult('Done'));
      // Second: never completes
      mockComplete.mockImplementationOnce(() => new Promise(() => {}));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', { task: 'done', agents: ['a'], label: 'done-run' });
      await executeTool(harness, 'orchestrate', { task: 'active', agents: ['a'], background: true, label: 'active-run' });

      const activeResult = await executeTool(harness, 'orchestrate.list', { active: true });
      const activeRuns = activeResult.output as Array<Record<string, JsonValue>>;
      expect(activeRuns.length).toBe(1);
      expect(activeRuns[0].label).toBe('active-run');

      const allResult = await executeTool(harness, 'orchestrate.list', {});
      const allRuns = allResult.output as Array<Record<string, JsonValue>>;
      expect(allRuns.length).toBe(2);
    });

    test('truncates long task descriptions', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));
      mockComplete.mockResolvedValueOnce(fakeAgentResult('Done'));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', {
        task: 'A'.repeat(200),
        agents: ['a'],
      });

      const listResult = await executeTool(harness, 'orchestrate.list', {});
      const runs = listResult.output as Array<Record<string, JsonValue>>;
      expect((runs[0].task as string).length).toBeLessThanOrEqual(81); // 80 + ellipsis
    });
  });

  // ── orchestrate.kill ─────────────────────────────────────────────

  describe('orchestrate.kill', () => {
    test('kills a running background task', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      mockComplete.mockImplementation(() => new Promise(() => {}));

      const harness = setupPlugin(registry);
      const spawnResult = await executeTool(harness, 'orchestrate', {
        task: 'Long task',
        agents: ['a'],
        background: true,
        label: 'kill-me',
      });
      const runId = (spawnResult.output as Record<string, JsonValue>).runId as string;

      // Kill by runId
      const killResult = await executeTool(harness, 'orchestrate.kill', { target: runId });
      expect(killResult.ok).toBe(true);
      expect((killResult.output as string)).toContain('Killed');

      // Verify it's dead
      const listResult = await executeTool(harness, 'orchestrate.list', {});
      const runs = listResult.output as Array<Record<string, JsonValue>>;
      const killedRun = runs.find((r) => r.runId === runId);
      expect(killedRun?.status).toBe('killed');
    });

    test('kills by label', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      mockComplete.mockImplementation(() => new Promise(() => {}));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', {
        task: 'Task',
        agents: ['a'],
        background: true,
        label: 'by-label',
      });

      const killResult = await executeTool(harness, 'orchestrate.kill', { target: 'by-label' });
      expect(killResult.ok).toBe(true);
    });

    test('kills by numeric index', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      mockComplete.mockImplementation(() => new Promise(() => {}));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', {
        task: 'Task',
        agents: ['a'],
        background: true,
      });

      const killResult = await executeTool(harness, 'orchestrate.kill', { target: '1' });
      expect(killResult.ok).toBe(true);
    });

    test('kills all active runs', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      mockComplete.mockImplementation(() => new Promise(() => {}));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', { task: 'T1', agents: ['a'], background: true });
      await executeTool(harness, 'orchestrate', { task: 'T2', agents: ['a'], background: true });

      const killResult = await executeTool(harness, 'orchestrate.kill', { target: 'all' });
      expect(killResult.ok).toBe(true);
      expect((killResult.output as string)).toContain('2');

      const listResult = await executeTool(harness, 'orchestrate.list', { active: true });
      const message = listResult.output as string;
      expect(message).toContain('No active');
    });

    test('returns error for non-existent target', async () => {
      const harness = setupPlugin();
      const result = await executeTool(harness, 'orchestrate.kill', { target: 'ghost' });
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('NOT_FOUND');
    });

    test('returns error when killing already-completed run', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));
      mockComplete.mockResolvedValueOnce(fakeAgentResult('Done'));

      const harness = setupPlugin(registry);
      const orchestrateResult = await executeTool(harness, 'orchestrate', {
        task: 'Quick',
        agents: ['a'],
        label: 'already-done',
      });

      const runId = (orchestrateResult.output as Record<string, JsonValue>).runId as string;
      const killResult = await executeTool(harness, 'orchestrate.kill', { target: runId });
      expect(killResult.ok).toBe(false);
      expect(killResult.error?.code).toBe('NOT_ACTIVE');
    });

    test('publishes orchestrate:killed event', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));

      mockComplete.mockImplementation(() => new Promise(() => {}));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', {
        task: 'Task',
        agents: ['a'],
        background: true,
        label: 'event-kill',
      });

      await executeTool(harness, 'orchestrate.kill', { target: 'event-kill' });

      const killedCalls = harness.events.publish.mock.calls.filter(
        (c: unknown[]) => c[0] === 'orchestrate:killed',
      );
      expect(killedCalls.length).toBe(1);
      expect(killedCalls[0][1].label).toBe('event-kill');
    });

    test('"all" with no active runs succeeds gracefully', async () => {
      const harness = setupPlugin();
      const result = await executeTool(harness, 'orchestrate.kill', { target: 'all' });
      expect(result.ok).toBe(true);
      expect((result.output as string)).toContain('No active');
    });
  });

  // ── Run Registry ─────────────────────────────────────────────────

  describe('RunRegistry', () => {
    test('resolve by runId prefix', () => {
      const reg = new RunRegistry();
      const record = {
        runId: 'abc12345',
        label: 'test',
        task: 'task',
        strategy: 'auto',
        agents: [],
        status: 'running' as const,
        background: false,
        depth: 0,
        createdAt: Date.now(),
      };
      reg.create(record);
      expect(reg.resolve('abc1')).toBe(record);
    });

    test('resolve by label', () => {
      const reg = new RunRegistry();
      const record = {
        runId: 'xyz',
        label: 'my-label',
        task: 'task',
        strategy: 'auto',
        agents: [],
        status: 'running' as const,
        background: false,
        depth: 0,
        createdAt: Date.now(),
      };
      reg.create(record);
      expect(reg.resolve('my-label')).toBe(record);
    });

    test('resolve by "last"', () => {
      const reg = new RunRegistry();
      reg.create({ runId: 'first', label: 'f', task: '', strategy: '', agents: [], status: 'running', background: false, depth: 0, createdAt: 1 });
      reg.create({ runId: 'second', label: 's', task: '', strategy: '', agents: [], status: 'running', background: false, depth: 0, createdAt: 2 });
      expect(reg.resolve('last')!.runId).toBe('second');
    });

    test('resolve by numeric index', () => {
      const reg = new RunRegistry();
      reg.create({ runId: 'a', label: 'a', task: '', strategy: '', agents: [], status: 'running', background: false, depth: 0, createdAt: 1 });
      reg.create({ runId: 'b', label: 'b', task: '', strategy: '', agents: [], status: 'running', background: false, depth: 0, createdAt: 2 });
      expect(reg.resolve('1')!.runId).toBe('a');
      expect(reg.resolve('2')!.runId).toBe('b');
      expect(reg.resolve('3')).toBeUndefined();
    });

    test('sweep removes old completed runs', () => {
      const reg = new RunRegistry();
      reg.create({
        runId: 'old',
        label: 'old',
        task: '',
        strategy: '',
        agents: [],
        status: 'completed',
        background: false,
        depth: 0,
        createdAt: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
      });
      reg.create({
        runId: 'recent',
        label: 'recent',
        task: '',
        strategy: '',
        agents: [],
        status: 'completed',
        background: false,
        depth: 0,
        createdAt: Date.now(),
      });

      const swept = reg.sweep();
      expect(swept).toBe(1);
      expect(reg.get('old')).toBeUndefined();
      expect(reg.get('recent')).toBeDefined();
    });

    test('sweep does not remove active runs', () => {
      const reg = new RunRegistry();
      reg.create({
        runId: 'active',
        label: 'active',
        task: '',
        strategy: '',
        agents: [],
        status: 'running',
        background: false,
        depth: 0,
        createdAt: Date.now() - 2 * 60 * 60 * 1000,
      });

      const swept = reg.sweep();
      expect(swept).toBe(0);
    });

    test('activeCount reflects live state', () => {
      const reg = new RunRegistry();
      expect(reg.activeCount()).toBe(0);

      reg.create({ runId: 'a', label: 'a', task: '', strategy: '', agents: [], status: 'running', background: false, depth: 0, createdAt: 1 });
      expect(reg.activeCount()).toBe(1);

      reg.create({ runId: 'b', label: 'b', task: '', strategy: '', agents: [], status: 'completed', background: false, depth: 0, createdAt: 2 });
      expect(reg.activeCount()).toBe(1);

      reg.create({ runId: 'c', label: 'c', task: '', strategy: '', agents: [], status: 'pending', background: false, depth: 0, createdAt: 3 });
      expect(reg.activeCount()).toBe(2);
    });
  });

  // ── Error handling ───────────────────────────────────────────────

  describe('error handling', () => {
    test('returns NO_LLM when services unavailable', async () => {
      const plugin = createOrchestratorPlugin();
      const tools = new Map<string, ToolDefinition>();

      plugin.setup({
        registerTool: (tool) => { tools.set(tool.id, tool as ToolDefinition); },
        registerCommand: () => undefined,
        registerService: () => undefined,
        registerHook: () => undefined,
        registerProvider: () => undefined,
        registerGatewayMethod: () => undefined,
        registerHttpRoute: () => undefined,
        registerChannel: () => undefined,
        contributePromptSection: () => undefined,
        contributeContextProvider: () => undefined,
        contributeStatusIndicator: () => (() => {}) as never,
        getService: () => undefined,
        dispatchHook: async (_domain, _event, payload) => ({
          initialPayload: payload,
          finalPayload: payload,
          failures: [],
        }),
        logger: noopLogger(),
      } as PluginRegistrationContext);

      const tool = tools.get('orchestrate')!;
      const result = await tool.execute({ task: 'Anything' } as JsonValue, {});

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('NO_LLM');
    });

    test('returns error when agent not found', async () => {
      const harness = setupPlugin();
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Do something',
        agents: ['nonexistent'],
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('ORCHESTRATE_ERROR');
      expect(result.error?.message).toContain('not found');
    });

    test('returns error when agent is disabled', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('off', 'Disabled', 'Off', { enabled: false }));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', {
        task: 'Do something',
        agents: ['off'],
      });

      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe('ORCHESTRATE_ERROR');
      expect(result.error?.message).toContain('disabled');
    });

    test('returns error for missing task', async () => {
      const harness = setupPlugin();
      const result = await executeTool(harness, 'orchestrate', {} as Record<string, JsonValue>);
      expect(result.ok).toBe(false);
    });

    test('completed run records durationMs', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));
      mockComplete.mockResolvedValueOnce(fakeAgentResult('Done'));

      const harness = setupPlugin(registry);
      const result = await executeTool(harness, 'orchestrate', { task: 'Go', agents: ['a'] });

      expect(result.ok).toBe(true);
      const output = result.output as Record<string, JsonValue>;
      expect(typeof output.durationMs).toBe('number');
      expect((output.durationMs as number)).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Event publishing ─────────────────────────────────────────────

  describe('events', () => {
    test('publishes routed, spawned, and completed events for blocking run', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));
      mockComplete.mockResolvedValueOnce(fakeAgentResult('Done'));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', { task: 'Go', agents: ['a'] });

      const eventTypes = harness.events.publish.mock.calls.map((c: unknown[]) => c[0]);
      expect(eventTypes).toContain('orchestrate:spawned');
      expect(eventTypes).toContain('orchestrate:routed');
      expect(eventTypes).toContain('orchestrate:completed');
    });

    test('completed event contains correct status', async () => {
      const registry = new MockAgentRegistry();
      registry.add(makeAgent('a', 'A', 'Agent'));
      mockComplete.mockResolvedValueOnce(fakeAgentResult('Done'));

      const harness = setupPlugin(registry);
      await executeTool(harness, 'orchestrate', { task: 'Go', agents: ['a'] });

      const completedCall = harness.events.publish.mock.calls.find(
        (c: unknown[]) => c[0] === 'orchestrate:completed',
      );
      expect(completedCall).toBeDefined();
      expect(completedCall![1].status).toBe('completed');
      expect(typeof completedCall![1].durationMs).toBe('number');
    });
  });
});
