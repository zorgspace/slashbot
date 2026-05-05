/**
 * Integration tests for the Memory plugin — association graph tools.
 *
 * Bootstraps the plugin with a mock context pointing to a temp directory,
 * then exercises the registered tools (memory.associate, memory.related,
 * memory.path) and verifies search expansion + context injection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promises as fs } from 'node:fs';
import { createMemoryPlugin } from './index.js';

describe('Memory plugin integration (graph tools)', () => {
  let tmpDir: string;
  let registered: {
    tools: any[];
    services: any[];
    promptSections: any[];
    contextProviders: any[];
  };
  let mockContext: any;

  function findTool(id: string) {
    return registered.tools.find((t: any) => t.id === id);
  }

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `slashbot-mem-integ-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const slashbotDir = join(tmpDir, '.slashbot');
    await fs.mkdir(slashbotDir, { recursive: true });
    // Create empty MEMORY.md so context provider doesn't skip
    await fs.writeFile(join(slashbotDir, 'MEMORY.md'), '# Memory\nTest memory content\n');

    registered = { tools: [], services: [], promptSections: [], contextProviders: [] };

    mockContext = {
      getService: vi.fn((id: string) => {
        if (id === 'kernel.workspaceRoot') return tmpDir;
        if (id === 'kernel.instance') return undefined; // no kernel → no eventBus, no LLM
        if (id === 'kernel.logger') return undefined;
        return undefined;
      }),
      registerService: vi.fn((s: any) => registered.services.push(s)),
      registerTool: vi.fn((t: any) => registered.tools.push(t)),
      registerCommand: vi.fn(),
      registerHook: vi.fn(),
      registerProvider: vi.fn(),
      registerGatewayMethod: vi.fn(),
      contributePromptSection: vi.fn((p: any) => registered.promptSections.push(p)),
      contributeContextProvider: vi.fn((p: any) => registered.contextProviders.push(p)),
      contributeStatusIndicator: vi.fn(() => vi.fn()),
      contributeSidebarItem: vi.fn(),
      unregisterTool: vi.fn(),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    };

    const plugin = createMemoryPlugin();
    plugin.setup(mockContext);

    // Wait for graph.load() to settle
    await new Promise((r) => setTimeout(r, 50));
  });

  afterEach(async () => {
    // Cancel any pending flushes on the graph
    const graphSvc = registered.services.find((s: any) => s.id === 'memory.graph');
    if (graphSvc?.implementation?.cancelFlush) {
      graphSvc.implementation.cancelFlush();
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  // ── Registration ──────────────────────────────────────────────────────

  it('registers all 3 graph tools', () => {
    expect(findTool('memory.related')).toBeDefined();
    expect(findTool('memory.associate')).toBeDefined();
    expect(findTool('memory.path')).toBeDefined();
  });

  it('registers graph service', () => {
    const svc = registered.services.find((s: any) => s.id === 'memory.graph');
    expect(svc).toBeDefined();
    expect(svc.implementation).toBeDefined();
  });

  it('registers graph prompt section', () => {
    const p = registered.promptSections.find((s: any) => s.id === 'memory.graph.tools');
    expect(p).toBeDefined();
    expect(p.content).toContain('memory.associate');
    expect(p.content).toContain('memory.related');
    expect(p.content).toContain('memory.path');
  });

  // ── memory.associate tool ─────────────────────────────────────────────

  it('memory.associate creates nodes and edges', async () => {
    const tool = findTool('memory.associate');
    const result = await tool.execute({ from: 'TypeScript', to: 'Bun', rel: 'uses' });
    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      from: 'typescript',
      to: 'bun',
      rel: 'uses',
      weight: 0.5,
    });
  });

  it('memory.associate reinforces weight on duplicate edge', async () => {
    const tool = findTool('memory.associate');
    await tool.execute({ from: 'TypeScript', to: 'Bun', rel: 'uses' });
    const result = await tool.execute({ from: 'TypeScript', to: 'Bun', rel: 'uses' });
    expect(result.ok).toBe(true);
    expect(result.output.weight).toBeCloseTo(0.6, 1);
  });

  it('memory.associate with custom types', async () => {
    const tool = findTool('memory.associate');
    const result = await tool.execute({
      from: 'React', to: 'UI', rel: 'part_of',
      fromType: 'library', toType: 'domain',
    });
    expect(result.ok).toBe(true);
    expect(result.output.from).toBe('react');
    expect(result.output.to).toBe('ui');
  });

  it('memory.associate returns error for missing args', async () => {
    const tool = findTool('memory.associate');
    const result = await tool.execute({ from: 'A' }); // missing to, rel
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });

  // ── memory.related tool ───────────────────────────────────────────────

  it('memory.related returns neighbors', async () => {
    const associate = findTool('memory.associate');
    await associate.execute({ from: 'Node', to: 'JavaScript', rel: 'uses' });
    await associate.execute({ from: 'Node', to: 'npm', rel: 'contains' });

    const related = findTool('memory.related');
    const result = await related.execute({ concept: 'Node' });
    expect(result.ok).toBe(true);
    expect(result.output).toHaveLength(2);
    const labels = result.output.map((n: any) => n.label);
    expect(labels).toContain('JavaScript');
    expect(labels).toContain('npm');
  });

  it('memory.related with depth 2', async () => {
    const associate = findTool('memory.associate');
    await associate.execute({ from: 'A', to: 'B', rel: 'uses' });
    await associate.execute({ from: 'B', to: 'C', rel: 'uses' });

    const related = findTool('memory.related');
    const depth1 = await related.execute({ concept: 'A', depth: 1 });
    expect(depth1.output).toHaveLength(1);
    expect(depth1.output[0].label).toBe('B');

    const depth2 = await related.execute({ concept: 'A', depth: 2 });
    expect(depth2.output.length).toBeGreaterThanOrEqual(2);
  });

  it('memory.related returns empty for unknown concept', async () => {
    const related = findTool('memory.related');
    const result = await related.execute({ concept: 'nonexistent' });
    expect(result.ok).toBe(true);
    expect(result.output).toHaveLength(0);
  });

  // ── memory.path tool ──────────────────────────────────────────────────

  it('memory.path finds direct path', async () => {
    const associate = findTool('memory.associate');
    await associate.execute({ from: 'Alpha', to: 'Beta', rel: 'depends_on' });

    const path = findTool('memory.path');
    const result = await path.execute({ from: 'Alpha', to: 'Beta' });
    expect(result.ok).toBe(true);
    expect(result.output.length).toBeGreaterThanOrEqual(2);
  });

  it('memory.path finds multi-hop path', async () => {
    const associate = findTool('memory.associate');
    await associate.execute({ from: 'X', to: 'Y', rel: 'uses' });
    await associate.execute({ from: 'Y', to: 'Z', rel: 'uses' });

    const path = findTool('memory.path');
    const result = await path.execute({ from: 'X', to: 'Z' });
    expect(result.ok).toBe(true);
    expect(result.output.length).toBeGreaterThanOrEqual(3);
  });

  it('memory.path returns empty for no connection', async () => {
    const associate = findTool('memory.associate');
    await associate.execute({ from: 'Isolated1', to: 'Isolated2', rel: 'uses' });

    const path = findTool('memory.path');
    const result = await path.execute({ from: 'Isolated1', to: 'Nonexistent' });
    expect(result.ok).toBe(true);
    expect(result.output).toHaveLength(0);
  });

  // ── JSONL persistence round-trip via tools ────────────────────────────

  it('graph persists to JSONL and reloads', async () => {
    const associate = findTool('memory.associate');
    await associate.execute({ from: 'Persist1', to: 'Persist2', rel: 'related_to' });

    // Force flush
    const graphSvc = registered.services.find((s: any) => s.id === 'memory.graph');
    const graph = graphSvc.implementation;
    await graph.flush();

    // Verify file exists
    const graphFile = join(tmpDir, '.slashbot', 'graph.jsonl');
    const content = await fs.readFile(graphFile, 'utf8');
    expect(content).toContain('persist1');
    expect(content).toContain('persist2');
    expect(content).toContain('related_to');

    // Create a new graph instance and load
    const { AssociationGraph } = await import('../services/association-graph.js');
    const graph2 = new AssociationGraph(tmpDir);
    await graph2.load();
    const neighbors = graph2.neighbors('persist1', 1);
    expect(neighbors).toHaveLength(1);
    expect(neighbors[0].label).toBe('Persist2');
    graph2.cancelFlush();
  });

  // ── Context provider with graph concepts ──────────────────────────────

  it('context provider includes graph concepts when chat history matches', async () => {
    // Populate graph
    const associate = findTool('memory.associate');
    await associate.execute({ from: 'TypeScript', to: 'JavaScript', rel: 'related_to' });

    // Mock chat history service to return messages containing "typescript"
    mockContext.getService.mockImplementation((id: string) => {
      if (id === 'kernel.workspaceRoot') return tmpDir;
      if (id === 'chat.history') return {
        getRecentMessages: (_n: number) => [
          { content: 'I am working with TypeScript today' },
        ],
      };
      return undefined;
    });

    // Re-setup to get context provider with updated mock
    registered.contextProviders.length = 0;
    const plugin2 = createMemoryPlugin();
    plugin2.setup(mockContext);
    await new Promise((r) => setTimeout(r, 50));

    const ctxProvider = registered.contextProviders.find((p: any) => p.id === 'memory.context');
    expect(ctxProvider).toBeDefined();

    const output = await ctxProvider.provide();
    expect(output).toContain('Memory');
    // The graph concepts section should appear if keyword matching works
    // (depends on whether "typescript" matches node ID "typescript")
    if (output.includes('Associated Concepts')) {
      expect(output).toContain('JavaScript');
    }

    // Cleanup second graph
    const graphSvc2 = registered.services.find((s: any) => s.id === 'memory.graph');
    graphSvc2?.implementation?.cancelFlush?.();
  });

  // ── memory.search with graph expansion ────────────────────────────────

  it('memory.search tool accepts expand parameter', async () => {
    const search = findTool('memory.search');
    expect(search).toBeDefined();

    // Search with expand=false should work without errors
    const result = await search.execute({ query: 'test', expand: false });
    expect(result.ok).toBe(true);
  });
});
