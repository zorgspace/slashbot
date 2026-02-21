/**
 * @module ui/tui-state
 *
 * State management for the SlashbotTui component.
 * Contains types, constants, pure utility functions, and the useTuiState() hook.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import type { SlashbotKernel } from '../core/kernel/kernel.js';
import type { AgentToolAction, TokenModeProxyAuthService } from '../core/agentic/llm/index.js';
import type { StatusIndicatorContribution, StructuredLogger } from '../core/kernel/contracts.js';
import type { ProviderRegistry, StatusIndicatorRegistry } from '../core/kernel/registries.js';
import type { AuthProfileRouter } from '../core/providers/auth-router.js';
import type { SpawnRequest } from '../core/kernel/spawn-bridge.js';
import type { ApprovalRequest } from '../core/kernel/approval-bridge.js';
import type { SubagentTask } from '../plugins/services/subagent-manager.js';
import type { AgentLoopDisplayState } from './agent-activity.js';
import type { ChatLine } from './palette.js';
import { VoltAgentAdapter } from '../core/voltagent/index.js';
import { loadHistory } from '../core/history.js';
import type { AgentRegistry } from '../plugins/agents/index.js';

// ── Types ──────────────────────────────────────────────────────────────

export interface SlashbotTuiProps {
  kernel: SlashbotKernel;
  sessionId: string;
  agentId: string;
  requireOnboarding?: boolean;
}

export interface QueuedPrompt {
  value: string;
  images: string[];
}

export interface PaletteState {
  mode: 'closed' | 'command' | 'subcommand' | 'agent';
  items: Array<{ id: string; description: string }>;
  parentCmd: string;
  prefix: string;
}

// ── Constants ──────────────────────────────────────────────────────────

export const CONTEXT_BYPASS_PREFIXES = new Set([
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

export const BUSY_CHAR = '\u25D0';

export const initialAgentState: AgentLoopDisplayState = { title: '', thoughts: '', actions: [], summary: '', done: false };

// ── Pure utility functions ─────────────────────────────────────────────

export function normalizeAssistantText(text: string): string {
  return text
    .replace(/(^|\n)(\s*)-(\S)/g, '$1$2- $3');
}

export function redactSensitivePromptForDisplay(input: string): string {
  const match = /^(\s*\/?solana\s+unlock\s+)([\s\S]*)$/i.exec(input);
  if (!match) return input;
  const prefix = match[1] ?? '';
  const secret = match[2] ?? '';
  const maskedSecret = secret.replace(/\S/g, '*');
  return `${prefix}${maskedSecret}`;
}

export function isSensitivePrompt(input: string): boolean {
  return /^(\s*\/?solana\s+unlock\s+\S+)/i.test(input);
}

export function shouldBypassRecentContext(input: string): boolean {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.includes('\n')) return false;

  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.toLowerCase() ?? '';
  if (CONTEXT_BYPASS_PREFIXES.has(first)) return true;

  return parts.length === 1 && /^[a-z0-9._-]{1,32}$/i.test(parts[0] ?? '');
}

export function compactContextText(text: string, maxLen = 220): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen)}...`;
}

export function applyToolEnd(state: AgentLoopDisplayState, action: AgentToolAction): AgentLoopDisplayState {
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

// ── useTuiState hook ───────────────────────────────────────────────────

export function useTuiState(kernel: SlashbotKernel, requireOnboarding?: boolean) {
  const [prompt, setPrompt] = useState('');
  const [pastedImages, setPastedImages] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [needsOnboarding, setNeedsOnboarding] = useState(Boolean(requireOnboarding));
  const [agentState, setAgentState] = useState<AgentLoopDisplayState>(initialAgentState);
  const [connectorAgentState, setConnectorAgentState] = useState<AgentLoopDisplayState>(initialAgentState);
  const [connectorAgentBusy, setConnectorAgentBusy] = useState(false);
  const [connectorDisplayLabel, setConnectorDisplayLabel] = useState('');
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
    return active ? `${active.providerId} \u00B7 ${active.modelId}` : 'no provider';
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
    return new VoltAgentAdapter(
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
  const paletteState = useMemo((): PaletteState => {
    const closed: PaletteState = { mode: 'closed' as const, items: [] as Array<{ id: string; description: string }>, parentCmd: '', prefix: '/' };

    // @agent completion
    if (prompt.startsWith('@')) {
      const body = prompt.slice(1);
      const spaceIdx = body.indexOf(' ');
      if (spaceIdx === -1) {
        // No space yet -> completing agent name
        const agentRegistry = kernel.services.get<AgentRegistry>('agents.registry');
        if (agentRegistry) {
          const lower = body.toLowerCase();
          const items = agentRegistry.list()
            .filter(a => a.enabled && a.id.toLowerCase().startsWith(lower))
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(a => ({ id: a.id, description: `${a.name}${a.role ? ` \u2014 ${a.role}` : ''}` }));
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
      // No space yet -> completing command name
      const lower = body.toLowerCase();
      const items = allCommands
        .filter(cmd => cmd.id.toLowerCase().startsWith(lower))
        .sort((a, b) => a.id.localeCompare(b.id));
      return { mode: 'command' as const, items, parentCmd: '', prefix: '/' };
    }

    // Space found -> check if word before space is a command with subcommands
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

  const pushLine = useCallback((line: ChatLine) => {
    setLines((prev) => [...prev, line].slice(-500));
  }, []);

  return {
    // Simple state
    prompt,
    setPrompt,
    pastedImages,
    setPastedImages,
    history,
    setHistory,
    historyIndex,
    setHistoryIndex,
    busy,
    setBusy,
    needsOnboarding,
    setNeedsOnboarding,
    agentState,
    setAgentState,
    connectorAgentState,
    setConnectorAgentState,
    connectorAgentBusy,
    setConnectorAgentBusy,
    connectorDisplayLabel,
    setConnectorDisplayLabel,
    subagents,
    setSubagents,
    lines,
    setLines,
    activeSpawns,
    setActiveSpawns,
    activeApproval,
    setActiveApproval,
    indicators,
    indicatorRegistryRef,
    setIndicatorTick,
    providerLabel,
    setProviderLabel,
    paletteIndex,
    setPaletteIndex,

    // Refs
    lastLogRef,
    linesRef,
    pasteInFlightRef,
    queuedPromptsRef,
    abortRef,
    connectorAgentContextRef,
    connectorAgentDepthRef,
    agentDoneTimerRef,
    connectorDoneTimerRef,
    approvalQueueRef,

    // Callbacks
    addSpawnRequest,
    removeSpawnRequest,
    enqueueApprovalRequest,
    dequeueApprovalRequest,
    pushLine,

    // Derived / memoized
    llm,
    shortCwd,
    allCommands,
    paletteState,
    filteredCommands,
    paletteParentCmd,
    paletteItemPrefix,
    paletteOpen,
  };
}

/** Return type of useTuiState for use in handler signatures. */
export type TuiState = ReturnType<typeof useTuiState>;
