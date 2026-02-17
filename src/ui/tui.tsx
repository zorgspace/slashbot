import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Writable } from 'node:stream';
import { appendFileSync } from 'node:fs';
import { Box, Text, useApp, useInput } from 'ink';

function debugLog(msg: string): void {
  try { appendFileSync('/tmp/slashbot-debug.log', `[tui ${new Date().toISOString()}] ${msg}\n`); } catch {}
}
import Spinner from 'ink-spinner';
import { useSpawn } from 'ink-spawn';
import type { SlashbotKernel } from '../core/kernel/kernel.js';
import { KernelLlmAdapter } from '../core/agentic/llm/index.js';
import type { AgentToolAction, TokenModeProxyAuthService } from '../core/agentic/llm/index.js';
import type { StatusIndicatorContribution, StructuredLogger } from '../core/kernel/contracts.js';
import type { ProviderRegistry, StatusIndicatorRegistry } from '../core/kernel/registries.js';
import type { AuthProfileRouter } from '../core/providers/auth-router.js';
import type { KernelLogger, LogEntry } from '../core/kernel/logger.js';
import { SpawnBridge, type SpawnRequest } from '../core/kernel/spawn-bridge.js';
import { ApprovalBridge, type ApprovalRequest } from '../core/kernel/approval-bridge.js';
import type { SubagentTask } from '../plugins/services/subagent-manager.js';
import { commandExists } from '../core/kernel/safe-command.js';
import { SetupWizard } from './setup-wizard.js';
import { palette, type ChatLine } from './palette.js';
import { useTerminalSize } from './hooks.js';
import { HeaderBar, HEADER_HEIGHT } from './header-bar.js';
import { Separator } from './separator.js';
import { MessageLine } from './message-line.js';
import { AgentActivity, type AgentLoopDisplayState } from './agent-activity.js';
import { InputRow } from './input-row.js';
import { CommandPalette } from './command-palette.js';
import { appendHistory, clearHistory, loadHistory } from '../core/history.js';
import type { AgentRegistry } from '../plugins/agents/index.js';
import { readClipboardImageData, readClipboardText } from './clipboard-image.js';

// ── Types ──────────────────────────────────────────────────────────────

interface SlashbotTuiProps {
  kernel: SlashbotKernel;
  sessionId: string;
  agentId: string;
  requireOnboarding?: boolean;
}

interface QueuedPrompt {
  value: string;
  images: string[];
}

const CONTEXT_BYPASS_PREFIXES = new Set([
  'ls',
  'pwd',
  'cd',
  'cat',
  'head',
  'tail',
  'wc',
  'grep',
  'find',
  'rg',
  'tree',
  'git',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'node',
  'python',
  'python3',
  'bash',
  'sh',
  'zsh',
  'make',
  'docker',
  'kubectl',
  'date',
  'whoami',
]);
const BUSY_SPINNER_TYPE = 'simpleDots';

function normalizeAssistantText(text: string): string {
  return text
    .replace(/(^|\n)(\s*)-(\S)/g, '$1$2- $3');
}

function redactSensitivePromptForDisplay(input: string): string {
  const match = /^(\s*\/?solana\s+unlock\s+)([\s\S]*)$/i.exec(input);
  if (!match) return input;
  const prefix = match[1] ?? '';
  const secret = match[2] ?? '';
  const maskedSecret = secret.replace(/\S/g, '*');
  return `${prefix}${maskedSecret}`;
}

function isSensitivePrompt(input: string): boolean {
  return /^(\s*\/?solana\s+unlock\s+\S+)/i.test(input);
}

function shouldBypassRecentContext(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.includes('\n')) return false;

  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.toLowerCase() ?? '';
  if (CONTEXT_BYPASS_PREFIXES.has(first)) return true;

  return parts.length === 1 && /^[a-z0-9._-]{1,32}$/i.test(parts[0] ?? '');
}

function compactContextText(text: string, maxLen = 220): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen)}...`;
}

function applyToolEnd(state: AgentLoopDisplayState, action: AgentToolAction): AgentLoopDisplayState {
  // 1. Try exact ID match (stable UUID from agent-loop)
  if (action.id) {
    const idx = state.actions.findIndex(a => a.id === action.id && a.status === 'running');
    if (idx !== -1) {
      const updated = [...state.actions];
      updated[idx] = { ...updated[idx], status: action.status, result: action.result, error: action.error };
      return { ...state, actions: updated };
    }
  }
  // 2. Fallback: last running action with same toolId (legacy / connector paths)
  return {
    ...state,
    actions: state.actions.map((a, i) =>
      a.toolId === action.toolId && a.status === 'running' && !state.actions.slice(i + 1).some((later) => later.toolId === action.toolId && later.status === 'running')
        ? { ...a, status: action.status, result: action.result, error: action.error }
        : a
    ),
  };
}

function estimateWrappedRows(text: string, width: number): number {
  const safeWidth = Math.max(8, width);
  return text.split('\n').reduce((total, part) => {
    const lineLength = Math.max(1, part.length);
    return total + Math.max(1, Math.ceil(lineLength / safeWidth));
  }, 0);
}

// ── SpawnRunner (invisible, manages ink-spawn lifecycle) ───────────────

const SPAWN_MAX_OUTPUT = 10_000;

function truncateSpawnOutput(text: string): string {
  if (text.length <= SPAWN_MAX_OUTPUT) return text;
  return `${text.slice(0, SPAWN_MAX_OUTPUT)}\n... (truncated, ${text.length - SPAWN_MAX_OUTPUT} more chars)`;
}

function SpawnRunner({ request, onDone }: { request: SpawnRequest; onDone: () => void }) {
  const stdoutRef = useRef('');
  const stderrRef = useRef('');
  const resolvedRef = useRef(false);

  const resolve = useCallback((result: Parameters<SpawnRequest['resolve']>[0]) => {
    if (resolvedRef.current) return;
    resolvedRef.current = true;
    request.resolve(result);
    onDone();
  }, [request, onDone]);

  const { spawn } = useSpawn((error) => {
    const truncOut = truncateSpawnOutput(stdoutRef.current);
    const truncErr = truncateSpawnOutput(stderrRef.current);
    if (error) {
      resolve({
        ok: false,
        output: truncOut,
        error: { code: 'COMMAND_FAILED', message: `Command exited with code ${error.code ?? 'unknown'}` },
        metadata: { stdout: truncOut, stderr: truncErr, code: error.code ?? -1 },
      });
    } else {
      resolve({
        ok: true,
        output: truncOut,
        metadata: { stdout: truncOut, stderr: truncErr, code: 0 },
      });
    }
  });

  const stdout = useMemo(() => new Writable({
    write(chunk, _enc, cb) { stdoutRef.current += chunk.toString(); cb(); },
  }), []);

  const stderr = useMemo(() => new Writable({
    write(chunk, _enc, cb) { stderrRef.current += chunk.toString(); cb(); },
  }), []);

  useEffect(() => {
    // Guard against ENOENT crash: ink-spawn throws (crashes process) on
    // non-SpawnFailure errors.  Resolve gracefully if binary is missing.
    if (!commandExists(request.command)) {
      resolve({
        ok: false,
        error: {
          code: 'COMMAND_NOT_FOUND',
          message: `Command not found: "${request.command}" is not installed on this system.`,
        },
      });
      return;
    }

    try {
      spawn(request.command, request.args, {
        cwd: request.cwd,
        stdout,
        stderr,
        outputMode: 'inherit',
      });
    } catch (err) {
      resolve({
        ok: false,
        error: {
          code: 'SPAWN_ERROR',
          message: err instanceof Error ? err.message : String(err),
        },
      });
      return;
    }

    const timer = setTimeout(() => {
      resolve({
        ok: false,
        error: { code: 'COMMAND_TIMEOUT', message: `Timed out after ${request.timeoutMs}ms` },
        metadata: { stdout: truncateSpawnOutput(stdoutRef.current), stderr: truncateSpawnOutput(stderrRef.current) },
      });
    }, request.timeoutMs);

    // Listen for abort signal to kill early
    const onAbort = () => {
      resolve({
        ok: false,
        error: { code: 'COMMAND_CANCELLED', message: 'Cancelled by user' },
        metadata: { stdout: truncateSpawnOutput(stdoutRef.current), stderr: truncateSpawnOutput(stderrRef.current) },
      });
    };
    request.abortSignal?.addEventListener('abort', onAbort, { once: true });

    return () => {
      clearTimeout(timer);
      request.abortSignal?.removeEventListener('abort', onAbort);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

// ── ApprovalPrompt (renders interactive y/n for risky commands) ────────

function ApprovalPrompt({ request, onDone }: { request: ApprovalRequest; onDone: () => void }) {
  const resolvedRef = useRef(false);
  const fullCommand = [request.command, ...request.args].join(' ');

  useInput((input, key) => {
    if (resolvedRef.current) return;

    if (input === 'y' || input === 'Y') {
      resolvedRef.current = true;
      // Approve: resolve with a special marker so the tool can re-execute
      request.resolve({
        ok: true,
        output: 'APPROVED',
        metadata: { approved: true, command: request.command, args: request.args, cwd: request.cwd },
      });
      onDone();
    } else if (input === 'n' || input === 'N' || key.escape) {
      resolvedRef.current = true;
      request.resolve({
        ok: false,
        error: { code: 'APPROVAL_DENIED', message: `User denied execution of: ${fullCommand}` },
      });
      onDone();
    }
  });

  return (
    <Box>
      <Box marginRight={1}>
        <Text>{`⚠️  Allow \`${fullCommand}\`? [y/n]`}</Text>
      </Box>
    </Box>
  );
}

// ── Main component ─────────────────────────────────────────────────────

export function SlashbotTui(props: SlashbotTuiProps): React.ReactElement {
  const { kernel, sessionId, agentId, requireOnboarding } = props;
  const { exit } = useApp();
  const { rows, cols } = useTerminalSize();

  const [prompt, setPrompt] = useState('');
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(Boolean(requireOnboarding));
  const initialAgentState: AgentLoopDisplayState = { title: '', thoughts: '', actions: [], summary: '', done: false };
  const [agentState, setAgentState] = useState<AgentLoopDisplayState>(initialAgentState);
  const [connectorAgentState, setConnectorAgentState] = useState<AgentLoopDisplayState>(initialAgentState);
  const [connectorAgentBusy, setConnectorAgentBusy] = useState(false);
  const [subagents, setSubagents] = useState<SubagentTask[]>([]);
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [activeSpawns, setActiveSpawns] = useState<SpawnRequest[]>([]);
  const [activeApproval, setActiveApproval] = useState<ApprovalRequest | null>(null);
  const indicatorRegistryRef = useRef(kernel.services.get<StatusIndicatorRegistry>('kernel.statusIndicators.registry'));
  const [indicators] = useState<StatusIndicatorContribution[]>(() => {
    return indicatorRegistryRef.current?.list() ?? [];
  });
  // Bumped by status events to force re-render; actual status is always
  // read live from indicator.getInitialStatus() during render.
  const [, setIndicatorTick] = useState(0);
  const [providerLabel, setProviderLabel] = useState<string>(() => {
    const active = kernel.config.providers.active;
    return active ? `${active.providerId} · ${active.modelId}` : 'no provider';
  });

  const [paletteIndex, setPaletteIndex] = useState(0);

  const lastLogRef = useRef<string>('');
  const linesRef = useRef<ChatLine[]>([]);
  const pasteInFlightRef = useRef(false);
  const queuedPromptsRef = useRef<QueuedPrompt[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const connectorAgentContextRef = useRef<string | null>(null);
  const connectorAgentDepthRef = useRef(0);
  const agentDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectorDoneTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const approvalQueueRef = useRef<ApprovalRequest[]>([]);

  const addSpawnRequest = useCallback((request: SpawnRequest) => {
    setActiveSpawns((prev) => [...prev, request]);
  }, []);

  const removeSpawnRequest = useCallback((id: string) => {
    setActiveSpawns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const enqueueApprovalRequest = useCallback((request: ApprovalRequest) => {
    setActiveApproval((current) => {
      if (!current) return request;
      approvalQueueRef.current.push(request);
      return current;
    });
  }, []);

  const dequeueApprovalRequest = useCallback(() => {
    setActiveApproval(() => approvalQueueRef.current.shift() ?? null);
  }, []);

  const llm = useMemo(() => {
    const authRouter = kernel.services.get<AuthProfileRouter>('kernel.authRouter');
    const providers = kernel.services.get<ProviderRegistry>('kernel.providers.registry');
    const logger = kernel.services.get<StructuredLogger>('kernel.logger') ?? kernel.logger;
    if (!authRouter || !providers) return null;
    return new KernelLlmAdapter(
      authRouter,
      providers,
      logger,
      kernel,
      () => kernel.services.get<TokenModeProxyAuthService>('wallet.proxyAuth'),
    );
  }, [kernel]);
  const shortCwd = useMemo(() => process.cwd().replace(process.env.HOME ?? '', '~'), []);

  // ── Command palette derived state ─────────────────────────────────────
  const allCommands = useMemo(() => kernel.commands.list(), [kernel]);

  // Parse prompt: detect command vs subcommand vs @agent completion mode
  const paletteState = useMemo(() => {
    const closed = { mode: 'closed' as const, items: [] as Array<{ id: string; description: string }>, parentCmd: '', prefix: '/' };

    // @agent completion
    if (prompt.startsWith('@')) {
      const body = prompt.slice(1);
      const spaceIdx = body.indexOf(' ');
      if (spaceIdx === -1) {
        // No space yet → completing agent name
        const agentRegistry = kernel.services.get<AgentRegistry>('agents.registry');
        if (agentRegistry) {
          const lower = body.toLowerCase();
          const items = agentRegistry.list()
            .filter(a => a.enabled && a.id.toLowerCase().startsWith(lower))
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(a => ({ id: a.id, description: `${a.name}${a.role ? ` — ${a.role}` : ''}` }));
          return { mode: 'agent' as const, items, parentCmd: '', prefix: '@' };
        }
      }
      return closed;
    }

    // /command completion
    if (!prompt.startsWith('/')) return closed;
    const body = prompt.slice(1);
    const spaceIdx = body.indexOf(' ');

    if (spaceIdx === -1) {
      // No space yet → completing command name
      const lower = body.toLowerCase();
      const items = allCommands
        .filter(cmd => cmd.id.toLowerCase().startsWith(lower))
        .sort((a, b) => a.id.localeCompare(b.id));
      return { mode: 'command' as const, items, parentCmd: '', prefix: '/' };
    }

    // Space found → check if word before space is a command with subcommands
    const cmdName = body.slice(0, spaceIdx);
    const cmd = allCommands.find(c => c.id === cmdName);
    if (cmd?.subcommands?.length) {
      const afterCmd = body.slice(spaceIdx + 1).trimStart();
      const subArg = afterCmd.split(/\s/)[0];
      const subComplete = afterCmd.length > subArg.length; // space after subcommand = done
      if (!subComplete) {
        const lower = subArg.toLowerCase();
        const items = cmd.subcommands
          .filter(s => s.toLowerCase().startsWith(lower))
          .sort()
          .map(s => ({ id: s, description: '' }));
        return { mode: 'subcommand' as const, items, parentCmd: cmd.id, prefix: '' };
      }
    }

    return closed;
  }, [prompt, allCommands, kernel]);

  const { items: filteredCommands, parentCmd: paletteParentCmd, prefix: paletteItemPrefix } = paletteState;
  const paletteOpen = paletteState.mode !== 'closed' && filteredCommands.length > 0 && !busy;

  // Reset selection when filter changes
  const filterKey = paletteState.mode === 'agent'
    ? `@${prompt.slice(1).split(/\s/)[0]}`
    : paletteState.mode === 'command'
      ? prompt.slice(1).split(/\s/)[0]
      : `${paletteParentCmd}:${prompt}`;
  useEffect(() => {
    setPaletteIndex(0);
  }, [filterKey]);

  // ── SpawnBridge registration ─────────────────────────────────────────

  useEffect(() => {
    const bridge = new SpawnBridge();
    kernel.services.register({
      id: 'kernel.spawnBridge',
      pluginId: 'kernel',
      description: 'TUI spawn bridge for ink-spawn process rendering',
      implementation: bridge,
    });
    const unsub = bridge.onRequest(addSpawnRequest);
    return () => {
      unsub();
    };
  }, [addSpawnRequest, kernel]);

  // ── ApprovalBridge registration ───────────────────────────────────────

  useEffect(() => {
    const bridge = new ApprovalBridge();
    kernel.services.register({
      id: 'kernel.approvalBridge',
      pluginId: 'kernel',
      description: 'TUI approval bridge for risky command confirmation',
      implementation: bridge,
    });
    const unsub = bridge.onRequest(enqueueApprovalRequest);
    return () => {
      approvalQueueRef.current = [];
      unsub();
    };
  }, [enqueueApprovalRequest, kernel]);

  // ── CLI channel registration ────────────────────────────────────────

  const pushLineRef = useRef<(line: ChatLine) => void>();

  useEffect(() => {
    kernel.channels.register({
      id: 'cli',
      pluginId: 'kernel',
      description: 'TUI chat channel',
      connector: true,
      send: async (payload) => {
        const text = typeof payload === 'string' ? payload : JSON.stringify(payload);
        pushLineRef.current?.({
          id: `cli-channel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'system',
          text,
        });
      },
    });
  }, [kernel]);

  // ── pushLine ───────────────────────────────────────

  const pushLine = useCallback((line: ChatLine) => {
    setLines((prev) => [...prev, line].slice(-500));
  }, []);
  pushLineRef.current = pushLine;

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  // ── Logger subscription (deduplicated) ─────────────────────────────

  useEffect(() => {
    const logger = kernel.services.get<KernelLogger>('kernel.logger');
    if (!logger || typeof logger.subscribe !== 'function') return;

    const unsubscribe = logger.subscribe((entry: LogEntry) => {
      if (entry.level === 'debug') return;

      const msg = `[${entry.level}] ${entry.message}`;
      if (msg === lastLogRef.current) return;
      lastLogRef.current = msg;

      const fields = entry.fields ? ` ${JSON.stringify(entry.fields).slice(0, 120)}` : '';
      pushLine({
        id: `log-${entry.ts}-${Math.random()}`,
        role: 'system',
        text: `${msg}${fields}`,
        logLevel: entry.level,
      });
    });

    return () => { unsubscribe(); };
  }, [kernel, pushLine]);

  // ── Status indicator subscriptions (registry-driven) ────────────────

  useEffect(() => {
    if (indicators.length === 0) return;

    const registry = kernel.services.get<StatusIndicatorRegistry>('kernel.statusIndicators.registry');
    const unsubs: Array<() => void> = [];

    // Registry onChange — fires synchronously when any plugin calls updateStatus().
    // Triggers re-render so the header reads the new status from the registry.
    if (registry) {
      unsubs.push(registry.onChange(() => setIndicatorTick((t) => t + 1)));
    }

    // Subscribe to each indicator's statusEvent for chat line display
    for (const ind of indicators) {
      const unsub = kernel.events.subscribe(ind.statusEvent, (event) => {
        if (ind.kind === 'connector') {
          const s = (event.payload as Record<string, unknown>).status as string;
          // Skip 'connected' — already visible in the header indicator dot.
          if (s === 'connected') return;
          pushLine({
            id: `ind-status-${ind.id}-${Date.now()}`,
            role: 'system',
            text: `${ind.label}: ${s}`,
            logLevel: s === 'busy' ? 'error' : undefined,
          });
        }
      });
      unsubs.push(unsub);

      // Subscribe to messageEvent if present
      if (ind.messageEvent) {
        const unsubMsg = kernel.events.subscribe(ind.messageEvent, (event) => {
          const payload = event.payload as Record<string, unknown>;
          const direction = payload.direction === 'out' ? 'out' : 'in';
          const role = direction === 'out' ? 'assistant' : 'user';
          const chatId = typeof payload.chatId === 'string' ? payload.chatId : 'unknown';
          const modality = payload.modality === 'voice' || payload.modality === 'photo' ? payload.modality : 'text';
          const text = typeof payload.text === 'string' ? payload.text.trim() : '';
          if (!text) return;

          const modalityPrefix = modality === 'voice' ? '🎙️ ' : modality === 'photo' ? '📷 ' : '';
          pushLine({
            id: `msg-${ind.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            role,
            label: ind.label,
            text: `${modalityPrefix}${text}`,
          });
        });
        unsubs.push(unsubMsg);
      }
    }

    // connector:agentic handler (uses registry for showActivity check)
    const unsubConnectorAgentic = kernel.events.subscribe('connector:agentic', (event) => {
      const payload = event.payload as Record<string, unknown>;
      const connector = typeof payload.connector === 'string' ? payload.connector : 'connector';
      const status = typeof payload.status === 'string' ? payload.status : '';
      const contextKey = typeof payload.contextKey === 'string' ? payload.contextKey : '';
      const payloadLabel = typeof payload.displayLabel === 'string' ? payload.displayLabel : connector;
      debugLog(`EVENT status=${status} connector=${connector} contextKey=${contextKey} depth=${connectorAgentDepthRef.current} ref=${connectorAgentContextRef.current ?? 'null'} toolId=${payload.toolId ?? ''} actionId=${payload.actionId ?? ''}`);
      if (!status || !contextKey) return;

      // Check registry: if indicator has showActivity === false, skip display.
      const ind = indicators.find(i => i.connectorName === connector);
      if (ind?.showActivity === false) return;

      if (status === 'started') {
        if (connectorAgentContextRef.current === contextKey) {
          connectorAgentDepthRef.current++;
          debugLog(`NESTED started depth=${connectorAgentDepthRef.current}`);
          return;
        }
        if (connectorAgentContextRef.current) {
          debugLog(`BLOCKED started: active ref=${connectorAgentContextRef.current} != ${contextKey}`);
          return;
        }
        if (connectorDoneTimerRef.current) { clearTimeout(connectorDoneTimerRef.current); connectorDoneTimerRef.current = null; }
        connectorAgentContextRef.current = contextKey;
        connectorAgentDepthRef.current = 1;
        setConnectorAgentBusy(true);
        setConnectorAgentState({
          title: payloadLabel,
          thoughts: '',
          actions: [],
          summary: '',
          done: false,
        });
        return;
      }

      if (connectorAgentContextRef.current && contextKey !== connectorAgentContextRef.current) {
        return;
      }

      if (status === 'title') {
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';
        if (!text) return;
        if (connectorAgentDepthRef.current <= 1) {
          setConnectorAgentState((prev) => ({ ...prev, title: text }));
        }
      } else if (status === 'thought') {
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';
        if (!text) return;
        if (connectorAgentDepthRef.current <= 1) {
          setConnectorAgentState((prev) => ({ ...prev, thoughts: text }));
        }
      } else if (status === 'tool_start') {
        const toolId = typeof payload.toolId === 'string' ? payload.toolId : 'unknown-tool';
        const toolName = typeof payload.toolName === 'string' ? payload.toolName : toolId;
        const toolDescription = typeof payload.toolDescription === 'string' ? payload.toolDescription : '';
        const actionId = typeof payload.actionId === 'string' ? payload.actionId : `connector-tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const args = (payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)) ? payload.args as Record<string, unknown> : {};
        const action: AgentToolAction = {
          id: actionId,
          name: toolName,
          description: toolDescription,
          toolId,
          args,
          status: 'running',
        };
        setConnectorAgentState((prev) => ({ ...prev, actions: [...prev.actions, action] }));
      } else if (status === 'tool_end') {
        const toolId = typeof payload.toolId === 'string' ? payload.toolId : 'unknown-tool';
        const toolName = typeof payload.toolName === 'string' ? payload.toolName : toolId;
        const toolDescription = typeof payload.toolDescription === 'string' ? payload.toolDescription : '';
        const actionId = typeof payload.actionId === 'string' ? payload.actionId : '';
        const args = (payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args)) ? payload.args as Record<string, unknown> : {};
        const action: AgentToolAction = {
          id: actionId,
          name: toolName,
          description: toolDescription,
          toolId,
          args,
          status: typeof payload.error === 'string' && payload.error.length > 0 ? 'error' : 'done',
          result: typeof payload.result === 'string' ? payload.result : undefined,
          error: typeof payload.error === 'string' ? payload.error : undefined,
        };
        setConnectorAgentState((prev) => applyToolEnd(prev, action));
      } else if (status === 'compression' || status === 'summary') {
        const text = typeof payload.text === 'string' ? payload.text.trim() : '';
        if (!text) return;
        if (connectorAgentDepthRef.current <= 1) {
          setConnectorAgentState((prev) => ({ ...prev, summary: text }));
        }
      } else if (status === 'done') {
        // Progress is represented in AgentActivity; avoid extra chat logs.
      } else if (status === 'completed') {
        connectorAgentDepthRef.current = Math.max(0, connectorAgentDepthRef.current - 1);
        debugLog(`completed depth=${connectorAgentDepthRef.current}`);
        if (connectorAgentDepthRef.current > 0) return;
        setConnectorAgentBusy(false);
        setConnectorAgentState((prev) => ({ ...prev, done: true }));
        connectorAgentContextRef.current = null;
        connectorDoneTimerRef.current = setTimeout(() => {
          setConnectorAgentState(initialAgentState);
          connectorDoneTimerRef.current = null;
        }, 3000);
      } else if (status === 'error') {
        connectorAgentDepthRef.current = Math.max(0, connectorAgentDepthRef.current - 1);
        if (connectorAgentDepthRef.current > 0) return;
        setConnectorAgentBusy(false);
        setConnectorAgentState((prev) => ({ ...prev, done: true }));
        connectorAgentContextRef.current = null;
        pushLine({
          id: `connector-agentic-error-${Date.now()}`,
          role: 'system',
          text: `${payloadLabel} agentic task failed: ${payload.error ?? 'unknown'}`,
          logLevel: 'error',
        });
      }
    });
    unsubs.push(unsubConnectorAgentic);

    const unsubHistoryClear = kernel.events.subscribe('history:clear', () => {
      clearHistory();
      setLines([]);
      setHistory([]);
      setHistoryIndex(null);
      setPrompt('');
      setPastedImages([]);
      queuedPromptsRef.current = [];
      setAgentState({ title: '', thoughts: '', actions: [], summary: '', done: false });
      setConnectorAgentState({ title: '', thoughts: '', actions: [], summary: '', done: false });
      setConnectorAgentBusy(false);
      connectorAgentContextRef.current = null;
      connectorAgentDepthRef.current = 0;
    });
    unsubs.push(unsubHistoryClear);

    const unsubProvider = kernel.events.subscribe('provider:changed', (event) => {
      const p = event.payload as Record<string, unknown>;
      setProviderLabel(`${p.providerId} · ${p.modelId}`);
    });
    unsubs.push(unsubProvider);

    return () => {
      for (const unsub of unsubs) unsub();
      if (agentDoneTimerRef.current) clearTimeout(agentDoneTimerRef.current);
      if (connectorDoneTimerRef.current) clearTimeout(connectorDoneTimerRef.current);
    };
  }, [kernel, indicators, pushLine]);

  // ── Submit ─────────────────────────────────────────────────────────

  const runQueuedPrompt = useCallback(async (initialPrompt: QueuedPrompt) => {
    let current: QueuedPrompt | undefined = initialPrompt;
    setBusy(true);

    try {
      while (current) {
        const submittedImages = current.images;
        const value = current.value;
        const ac = new AbortController();
        abortRef.current = ac;

        setPrompt('');
        if (agentDoneTimerRef.current) { clearTimeout(agentDoneTimerRef.current); agentDoneTimerRef.current = null; }
        setAgentState({ title: '', thoughts: '', actions: [], summary: '', done: false });

        try {
          const displayValue = redactSensitivePromptForDisplay(value);
          pushLine({
            id: `user-${Date.now()}`,
            role: 'user',
            text: submittedImages.length > 0 ? `${displayValue}\n[${submittedImages.length} image(s) attached]` : displayValue,
          });

          await kernel.sendMessageLifecycle('message_received', sessionId, agentId, value);

          if (!llm) {
            pushLine({ id: `assistant-${Date.now()}`, role: 'assistant', text: 'LLM adapter unavailable. Configure a provider/API key.' });
            break;
          }

          await kernel.sendMessageLifecycle('message_sending', sessionId, agentId, value);
          setAgentState(s => ({ ...s, title: 'Thinking...' }));

          // Build messages array: system prompt + recent context + user message
          const systemPrompt = await kernel.assemblePrompt();

          const bypassRecentContext = shouldBypassRecentContext(value);
          const recentLines = bypassRecentContext
            ? ''
            : linesRef.current
              .filter((line) => line.role === 'user' || line.role === 'assistant')
              .slice(-4)
              .map((line) => `[${line.role}] ${compactContextText(line.text)}`)
              .join('\n');

          const userText = submittedImages.length > 0
            ? (
              recentLines.length > 0
                ? `Recent conversation:\n${recentLines}\n\nUser request: ${value}\n\nAttached image count: ${submittedImages.length}`
                : `User request: ${value}\n\nAttached image count: ${submittedImages.length}`
            )
            : (
              recentLines.length > 0
                ? `Recent conversation:\n${recentLines}\n\nUser request: ${value}`
                : value
            );

          const imageParts = submittedImages.slice(0, 4).map((img) => ({
            type: 'image' as const,
            image: img,
            mimeType: img.match(/^data:([^;,]+);base64,/i)?.[1],
          }));

          // Resolve @agent_id routing — strip prefix and apply agent config
          const agentRegistry = kernel.services.get<AgentRegistry>('agents.registry');
          const agentMatch = value.match(/^@([a-z0-9_-]+)\s+([\s\S]+)$/i);
          const routedAgent = agentMatch && agentRegistry
            ? agentRegistry.get(agentMatch[1].toLowerCase())
            : undefined;
          const effectiveUserText = routedAgent && agentMatch ? agentMatch[2].trim() : userText;

          const effectiveSystemPrompt = routedAgent?.systemPrompt
            ? `${systemPrompt}\n\n## Agent Instructions (${routedAgent.name})\n${routedAgent.systemPrompt}`
            : systemPrompt;

          const messages: import('../core/agentic/llm/index.js').AgentMessage[] = [
            { role: 'system', content: effectiveSystemPrompt },
            {
              role: 'user',
              content: imageParts.length > 0
                ? [{ type: 'text' as const, text: effectiveUserText }, ...imageParts]
                : effectiveUserText,
            },
          ];

          const result = await llm.complete(
            {
              sessionId: routedAgent ? `agents-${routedAgent.id}-${Date.now().toString(36)}` : sessionId,
              agentId: routedAgent?.id ?? agentId,
              messages,
              abortSignal: ac.signal,
              pinnedProviderId: routedAgent?.provider,
              pinnedModelId: routedAgent?.model,
              toolAllowlist: routedAgent?.toolAllowlist,
            },
            {
              onTitle: (title) => setAgentState(s => ({ ...s, title })),
              onThoughts: (text) => setAgentState(s => ({ ...s, thoughts: text })),
              onToolStart: (action) => setAgentState(s => ({
                ...s,
                actions: [...s.actions, action],
              })),
              onToolEnd: (action) => {
                setAgentState((s) => applyToolEnd(s, action));

                // Push fs.patch results as diff chat lines
                if (action.toolId === 'fs.patch' && action.status === 'done') {
                  const filePath = typeof action.args.path === 'string' ? action.args.path : '?';
                  const find = typeof action.args.find === 'string' ? action.args.find : '';
                  const replace = typeof action.args.replace === 'string' ? action.args.replace : '';
                  const diffLines = [
                    `diff --git a/${filePath} b/${filePath}`,
                    `--- a/${filePath}`,
                    `+++ b/${filePath}`,
                    '@@ patch @@',
                    ...find.split('\n').map(l => `-${l}`),
                    ...replace.split('\n').map(l => `+${l}`),
                  ];
                  pushLine({
                    id: `patch-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                    role: 'assistant',
                    text: diffLines.join('\n'),
                  });
                } else if (action.toolId === 'fs.patch' && action.status === 'error') {
                  const filePath = typeof action.args.path === 'string' ? action.args.path : '?';
                  pushLine({
                    id: `patch-err-${Date.now()}`,
                    role: 'system',
                    text: `fs.patch failed on ${filePath}: ${action.error ?? 'unknown error'}`,
                    logLevel: 'error',
                  });
                }
              },
              onSummary: (summary) => setAgentState(s => ({ ...s, summary })),
              onDone: () => {
                setAgentState(s => ({ ...s, done: true }));
                agentDoneTimerRef.current = setTimeout(() => {
                  setAgentState(initialAgentState);
                  agentDoneTimerRef.current = null;
                }, 3000);
              },
            },
          );

          // If preempted, silently drop the response
          if (ac.signal.aborted) break;

          const responseText = result.text;
          const normalizedResponse = normalizeAssistantText(responseText);
          pushLine({ id: `assistant-${Date.now()}`, role: 'assistant', text: normalizedResponse });
          await kernel.sendMessageLifecycle('message_sent', sessionId, agentId, normalizedResponse);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          pushLine({ id: `error-${Date.now()}`, role: 'system', text: message, logLevel: 'error' });
        } finally {
          abortRef.current = null;
          setAgentState(s => ({ ...s, done: true }));
        }

        current = queuedPromptsRef.current.shift();
        if (current) {
          pushLine({
            id: `queued-next-${Date.now()}`,
            role: 'system',
            text: `Running queued prompt (${queuedPromptsRef.current.length} remaining)...`,
          });
        }
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }, [agentId, kernel, llm, pushLine, sessionId]);

  const submit = useCallback(async (submittedValue?: string) => {
    const rawValue = (submittedValue ?? prompt).trim();
    const submittedImages = pastedImages;
    const value = rawValue.length > 0
      ? rawValue
      : submittedImages.length > 0
        ? 'Analyze the attached image context.'
        : '';

    if (rawValue && !isSensitivePrompt(value)) {
      setHistory((prev) => {
        const next = [...prev];
        if (next[next.length - 1] !== value) {
          next.push(value);
          appendHistory(value);
        }
        return next;
      });
      setHistoryIndex(null);
    }
    if (!value) return;
    setPastedImages([]);

    // ── Slash command interception (always allowed, even when busy) ──
    if (value.startsWith('/')) {
      if (submittedImages.length > 0) {
        pushLine({
          id: `attachments-ignored-${Date.now()}`,
          role: 'system',
          text: `Ignored ${submittedImages.length} pasted image(s): slash commands are text-only.`,
          logLevel: 'warn',
        });
      }
      const parts = value.slice(1).split(/\s+/);
      const cmdName = parts[0];
      const cmdArgs = parts.slice(1);
      const command = kernel.commands.get(cmdName);
      if (command) {
        setPrompt('');
        pushLine({
          id: `user-${Date.now()}`,
          role: 'user',
          text: redactSensitivePromptForDisplay(value),
        });
        let output = '';
        const writable = new Writable({ write(chunk, _enc, cb) { output += chunk.toString(); cb(); } });
        try {
          const exitCode = await kernel.runCommand(cmdName, cmdArgs, {
            cwd: process.cwd(),
            stdout: writable,
            stderr: writable,
            env: process.env,
            nonInteractive: false,
          });
          if (output.trimEnd()) {
            const rendered = output.trimEnd();
            const isBusyStatus = /\bstatus:\s*busy\b/i.test(rendered) || /\blocked\b/i.test(rendered);
            pushLine({
              id: `cmd-${Date.now()}`,
              role: 'system',
              text: rendered,
              logLevel: exitCode !== 0 || isBusyStatus ? 'error' : undefined,
            });
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          pushLine({ id: `error-${Date.now()}`, role: 'system', text: message, logLevel: 'error' });
        }
        return;
      }
      // No matching command -> fall through to the normal LLM prompt path
    }

    // Preempt: abort the current run and make the new prompt next
    if (busy) {
      if (abortRef.current) abortRef.current.abort();
      queuedPromptsRef.current = [{ value, images: submittedImages }];
      setPrompt('');
      pushLine({
        id: `preempt-${Date.now()}`,
        role: 'system',
        text: 'New message received — preempting current task...',
        logLevel: 'warn',
      });
      return;
    }

    await runQueuedPrompt({ value, images: submittedImages });
  }, [busy, kernel, prompt, pastedImages, pushLine, runQueuedPrompt]);

  const handlePasteImage = useCallback(() => {
    if (pasteInFlightRef.current || busy) return;
    pasteInFlightRef.current = true;

    void (async () => {
      try {
        const image = await readClipboardImageData();
        setPastedImages((prev) => [...prev, image.dataUrl]);
        pushLine({
          id: `attachment-${Date.now()}`,
          role: 'system',
          text: `Image attached from clipboard (${image.mimeType}, ${Math.max(1, Math.round(image.bytes / 1024))}KB).`,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        pushLine({
          id: `attachment-error-${Date.now()}`,
          role: 'system',
          text: `Clipboard image paste failed: ${message}`,
          logLevel: 'warn',
        });
      } finally {
        pasteInFlightRef.current = false;
      }
    })();
  }, [busy, pushLine]);

  const handlePasteText = useCallback(async (): Promise<string | null> => {
    try {
      return await readClipboardText();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      pushLine({
        id: `paste-error-${Date.now()}`,
        role: 'system',
        text: `Clipboard text paste failed: ${message}`,
        logLevel: 'warn',
      });
      return null;
    }
  }, [pushLine]);

  const statusRowHeight = 1;
  const reservedRows = HEADER_HEIGHT + 1 + 3 + statusRowHeight;
  const panelWidth = Math.max(24, cols);
  const contentViewportRows = Math.max(1, rows - reservedRows);
  const contentMinHeight = Math.max(1, Math.floor(contentViewportRows * 0.6));

  const estimatedContentRows = useMemo(() => {
    const textWidth = Math.max(20, panelWidth - 6);
    let total = 0;
    for (const line of lines) {
      total += estimateWrappedRows(line.text, textWidth) + 1; // +1 for message spacing
    }
    if (busy && agentState.actions.length > 0) total += agentState.actions.length + 2;
    if (paletteOpen && filteredCommands.length > 0) {
      total += Math.min(8, filteredCommands.length + 1);
    }
    return total;
  }, [agentState.actions.length, busy, filteredCommands.length, lines, paletteOpen, panelWidth]);

  // ── Input (global keys) ─────────────────────────────────────────────

  useInput((input, key) => {
    // Ctrl+C: stop agent if running, otherwise exit
    if (key.ctrl && input === 'c') {
      if (abortRef.current) {
        abortRef.current.abort();
        pushLine({ id: `cancel-${Date.now()}`, role: 'system', text: 'Cancelling...', logLevel: 'warn' });
      } else {
        exit();
      }
    }
  });

  // ── History navigation callbacks ──────────────────────────────────

  const handleUpArrow = useCallback(() => {
    // History navigation takes priority when user is actively browsing history
    if (paletteOpen && historyIndex === null) {
      setPaletteIndex(i => Math.max(0, i - 1));
      return;
    }
    if (history.length === 0) return;
    const nextIndex = historyIndex === null
      ? history.length - 1
      : Math.max(0, historyIndex - 1);
    setHistoryIndex(nextIndex);
    setPrompt(history[nextIndex] ?? '');
  }, [history, historyIndex, paletteOpen]);

  const handleDownArrow = useCallback(() => {
    // History navigation takes priority when user is actively browsing history
    if (paletteOpen && historyIndex === null) {
      setPaletteIndex(i => Math.min(filteredCommands.length - 1, i + 1));
      return;
    }
    if (history.length === 0 || historyIndex === null) return;
    const nextIndex = historyIndex + 1;
    if (nextIndex >= history.length) {
      setHistoryIndex(null);
      setPrompt('');
    } else {
      setHistoryIndex(nextIndex);
      setPrompt(history[nextIndex] ?? '');
    }
  }, [history, historyIndex, paletteOpen, filteredCommands.length]);

  const handleEscape = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      pushLine({ id: `cancel-${Date.now()}`, role: 'system', text: 'Cancelling...', logLevel: 'warn' });
    } else {
      setPrompt('');
      setHistoryIndex(null);
      if (pastedImages.length > 0) {
        setPastedImages([]);
        pushLine({ id: `attachments-cleared-${Date.now()}`, role: 'system', text: 'Cleared pasted image attachments.' });
      }
    }
  }, [pastedImages.length, pushLine]);

  const handleTab = useCallback(() => {
    if (!paletteOpen || filteredCommands.length === 0) return;
    const idx = Math.min(paletteIndex, filteredCommands.length - 1);
    if (paletteState.mode === 'agent') {
      setPrompt(`@${filteredCommands[idx].id} `);
    } else if (paletteState.mode === 'subcommand') {
      setPrompt(`/${paletteParentCmd} ${filteredCommands[idx].id} `);
    } else {
      setPrompt(`/${filteredCommands[idx].id} `);
    }
  }, [paletteOpen, filteredCommands, paletteIndex, paletteState.mode, paletteParentCmd]);

  // ── Render ─────────────────────────────────────────────────────────
  // Animated spinners during overflow can cause aggressive terminal repaint/auto-scroll.
  const anyAgentBusy = busy || connectorAgentBusy;
  const animateBusyIndicator = anyAgentBusy && estimatedContentRows <= contentViewportRows;

  return (
    <Box flexDirection="column" width={cols} minHeight={rows} alignItems="center">
      <Box flexDirection="column" width={panelWidth} minHeight={rows}>
        <HeaderBar
          cols={panelWidth}
          cwd={shortCwd}
          busy={anyAgentBusy}
          indicators={indicators.map(ind => ({
            id: ind.id,
            label: ind.label,
            kind: ind.kind,
            status: indicatorRegistryRef.current?.getStatus(ind.id) ?? 'disconnected',
          }))}
          provider={providerLabel}
        />
        <Separator cols={panelWidth} />

        <Box flexDirection="column" minHeight={contentMinHeight} width={panelWidth}>
          {needsOnboarding ? (
            <SetupWizard
              kernel={kernel}
              agentId={agentId}
              onComplete={(summary) => {
                setNeedsOnboarding(false);
                pushLine({ id: `onboarding-${Date.now()}`, role: 'system', text: summary });
              }}
            />
          ) : (
            <>
              {lines.map((line) => (
                <MessageLine key={line.id} line={line} cols={panelWidth} />
              ))}
              <AgentActivity state={agentState} busy={busy} cols={panelWidth} />
              <AgentActivity state={connectorAgentState} busy={connectorAgentBusy} cols={panelWidth} />
              {paletteOpen && filteredCommands.length > 0 && (
                <CommandPalette
                  commands={filteredCommands}
                  selectedIndex={paletteIndex}
                  cols={panelWidth}
                  prefix={paletteItemPrefix}
                />
              )}
            </>
          )}
        </Box>

        {activeSpawns.map((spawn) => (
          <SpawnRunner key={spawn.id} request={spawn} onDone={() => removeSpawnRequest(spawn.id)} />
        ))}
        {activeApproval && (
          <ApprovalPrompt request={activeApproval} onDone={dequeueApprovalRequest} />
        )}
        {!needsOnboarding && (
          <>
            <Box height={1} width={panelWidth}>
              {anyAgentBusy ? (
                <>
                  <Text color={palette.accent}>{'  '}</Text>
                  <Text color={palette.accent}>
                    {animateBusyIndicator ? <Spinner type={BUSY_SPINNER_TYPE} /> : '⋯'}
                  </Text>
                </>
              ) : (
                <Text>{' '}</Text>
              )}
            </Box>
            <InputRow
              busy={busy}
              prompt={prompt}
              setPrompt={setPrompt}
              onSubmit={(v) => {
                if (paletteOpen && filteredCommands.length > 0) {
                  let shouldAutocomplete = true;
                  if (paletteState.mode === 'command') {
                    const typedCommand = prompt.slice(1).split(/\s+/)[0] ?? '';
                    if (typedCommand.length > 0 && filteredCommands.some((command) => command.id === typedCommand)) {
                      shouldAutocomplete = false;
                    }
                  } else if (paletteState.mode === 'subcommand') {
                    const body = prompt.slice(1);
                    const spaceIdx = body.indexOf(' ');
                    const subTyped = spaceIdx === -1 ? '' : (body.slice(spaceIdx + 1).trimStart().split(/\s+/)[0] ?? '');
                    if (subTyped.length > 0 && filteredCommands.some((command) => command.id === subTyped)) {
                      shouldAutocomplete = false;
                    }
                  } else if (paletteState.mode === 'agent') {
                    const typedAgent = prompt.slice(1).split(/\s+/)[0] ?? '';
                    if (typedAgent.length > 0 && filteredCommands.some((command) => command.id === typedAgent)) {
                      shouldAutocomplete = false;
                    }
                  }

                  if (shouldAutocomplete) {
                    const idx = Math.min(paletteIndex, filteredCommands.length - 1);
                    if (paletteState.mode === 'agent') {
                      setPrompt(`@${filteredCommands[idx].id} `);
                    } else if (paletteState.mode === 'subcommand') {
                      setPrompt(`/${paletteParentCmd} ${filteredCommands[idx].id} `);
                    } else {
                      setPrompt(`/${filteredCommands[idx].id} `);
                    }
                    return;
                  }
                }
                void submit(v);
              }}
              onPasteImage={handlePasteImage}
              onPasteText={handlePasteText}
              cols={panelWidth}
              onUpArrow={handleUpArrow}
              onDownArrow={handleDownArrow}
              onEscape={handleEscape}
              onTab={handleTab}
            />
          </>
        )}
      </Box>
    </Box>
  );
}
