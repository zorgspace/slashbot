/**
 * @module ui/tui-handlers
 *
 * Input handling logic for the SlashbotTui component.
 * Contains message submission, command processing, clipboard handling,
 * history navigation, and keyboard shortcut callbacks.
 */

import { useCallback, useEffect } from 'react';
import { Writable } from 'node:stream';
import { useApp, useInput } from 'ink';
import type { SlashbotKernel } from '../core/kernel/kernel.js';
import type { AgentMessage } from '../core/agentic/llm/index.js';
import type { KernelLogger, LogEntry } from '../core/kernel/logger.js';
import { SpawnBridge } from '../core/kernel/spawn-bridge.js';
import { ApprovalBridge } from '../core/kernel/approval-bridge.js';
import type { StatusIndicatorRegistry } from '../core/kernel/registries.js';
import { appendHistory, clearHistory } from '../core/history.js';
import { readClipboardImageData, readClipboardText } from './clipboard-image.js';
import type { AgentRegistry } from '../plugins/agents/index.js';
import {
  type TuiState,
  type QueuedPrompt,
  initialAgentState,
  applyToolEnd,
  normalizeAssistantText,
  redactSensitivePromptForDisplay,
  isSensitivePrompt,
  shouldBypassRecentContext,
  compactContextText,
} from './tui-state.js';
import { debugLog } from './tui-utils.js';
import type { AgentToolAction } from '../core/agentic/llm/index.js';

// ── Side-effect hooks (bridge registration, subscriptions) ─────────────

export function useBridgeRegistration(kernel: SlashbotKernel, state: TuiState) {
  const { addSpawnRequest, enqueueApprovalRequest, approvalQueueRef } = state;

  // SpawnBridge registration
  useEffect(() => {
    const bridge = new SpawnBridge();
    kernel.services.upsert({
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

  // ApprovalBridge registration
  useEffect(() => {
    const bridge = new ApprovalBridge();
    kernel.services.upsert({
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
  }, [enqueueApprovalRequest, kernel, approvalQueueRef]);
}

export function useCliChannel(kernel: SlashbotKernel, state: TuiState) {
  const pushLineRef = { current: state.pushLine };

  useEffect(() => {
    kernel.channels.upsert({
      id: 'cli',
      pluginId: 'kernel',
      description: 'TUI chat channel',
      connector: true,
      send: async (payload) => {
        // Support targeted { text, chatId } payloads — extract text
        const obj = typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? payload as Record<string, unknown> : null;
        const text = obj && typeof obj.text === 'string' ? obj.text : (typeof payload === 'string' ? payload : JSON.stringify(payload));
        pushLineRef.current?.({
          id: `cli-channel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: 'system',
          text,
        });
      },
    });
  }, [kernel, pushLineRef]);
}

export function useLinesRefSync(state: TuiState) {
  const { lines, linesRef } = state;
  useEffect(() => {
    linesRef.current = lines;
  }, [lines, linesRef]);
}

export function useLoggerSubscription(kernel: SlashbotKernel, state: TuiState) {
  const { pushLine, lastLogRef } = state;

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
  }, [kernel, pushLine, lastLogRef]);
}

export function useIndicatorSubscriptions(kernel: SlashbotKernel, state: TuiState) {
  const {
    indicators, pushLine, setIndicatorTick,
    connectorAgentContextRef, connectorAgentDepthRef,
    connectorDoneTimerRef, agentDoneTimerRef,
    setConnectorAgentBusy, setConnectorAgentState, setConnectorDisplayLabel,
    setLines, setHistory, setHistoryIndex, setPrompt, setPastedImages,
    queuedPromptsRef, setAgentState, setProviderLabel,
  } = state;

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

          const modalityPrefix = modality === 'voice' ? '\uD83C\uDF99\uFE0F ' : modality === 'photo' ? '\uD83D\uDCF7 ' : '';
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
        setConnectorDisplayLabel(payloadLabel);
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
      setProviderLabel(`${p.providerId} \u00B7 ${p.modelId}`);
    });
    unsubs.push(unsubProvider);

    return () => {
      for (const unsub of unsubs) unsub();
      if (agentDoneTimerRef.current) clearTimeout(agentDoneTimerRef.current);
      if (connectorDoneTimerRef.current) clearTimeout(connectorDoneTimerRef.current);
    };
  }, [
    kernel, indicators, pushLine, setIndicatorTick,
    connectorAgentContextRef, connectorAgentDepthRef,
    connectorDoneTimerRef, agentDoneTimerRef,
    setConnectorAgentBusy, setConnectorAgentState, setConnectorDisplayLabel,
    setLines, setHistory, setHistoryIndex, setPrompt, setPastedImages,
    queuedPromptsRef, setAgentState, setProviderLabel,
  ]);
}

// ── Palette filter key effect ──────────────────────────────────────────

export function usePaletteFilterReset(state: TuiState) {
  const { paletteState, prompt, paletteParentCmd, setPaletteIndex } = state;

  const filterKey = paletteState.mode === 'agent'
    ? `@${prompt.slice(1).split(/\s/)[0]}`
    : paletteState.mode === 'command'
      ? prompt.slice(1).split(/\s/)[0]
      : `${paletteParentCmd}:${prompt}`;

  useEffect(() => {
    setPaletteIndex(0);
  }, [filterKey, setPaletteIndex]);
}

// ── Submit / input handlers ────────────────────────────────────────────

export function useSubmitHandler(
  kernel: SlashbotKernel,
  sessionId: string,
  agentId: string,
  state: TuiState,
) {
  const {
    prompt, setPrompt, pastedImages, setPastedImages,
    history, setHistory, historyIndex, setHistoryIndex,
    busy, setBusy,
    setNeedsOnboarding,
    agentState, setAgentState,
    agentDoneTimerRef,
    linesRef, queuedPromptsRef, abortRef,
    pushLine, llm,
    paletteOpen, filteredCommands, paletteIndex,
    paletteState, paletteParentCmd,
  } = state;

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

          const messages: AgentMessage[] = [
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
  }, [agentId, kernel, llm, pushLine, sessionId, setBusy, setPrompt, setAgentState, agentDoneTimerRef, abortRef, linesRef, queuedPromptsRef]);

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

      // /setup in TUI -> show the interactive SetupWizard component
      if (cmdName === 'setup') {
        setPrompt('');
        setNeedsOnboarding(true);
        return;
      }

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
        text: 'New message received \u2014 preempting current task...',
        logLevel: 'warn',
      });
      return;
    }

    await runQueuedPrompt({ value, images: submittedImages });
  }, [busy, kernel, prompt, pastedImages, pushLine, runQueuedPrompt, setHistory, setHistoryIndex, setPastedImages, setPrompt, setNeedsOnboarding, abortRef, queuedPromptsRef]);

  const handlePasteImage = useCallback(() => {
    const { pasteInFlightRef } = state;
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
  }, [busy, pushLine, setPastedImages, state]);

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

  return { submit, handlePasteImage, handlePasteText };
}

// ── Global key handler ─────────────────────────────────────────────────

export function useGlobalInput(state: TuiState) {
  const { abortRef, pushLine } = state;
  const { exit } = useApp();

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
}

// ── History / palette navigation ───────────────────────────────────────

export function useNavigationHandlers(state: TuiState) {
  const {
    history, historyIndex, setHistoryIndex, setPrompt,
    paletteOpen, filteredCommands, paletteIndex, setPaletteIndex,
    paletteState, paletteParentCmd,
    abortRef, pastedImages, setPastedImages, pushLine,
  } = state;

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
  }, [history, historyIndex, paletteOpen, setHistoryIndex, setPrompt, setPaletteIndex]);

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
  }, [history, historyIndex, paletteOpen, filteredCommands.length, setHistoryIndex, setPrompt, setPaletteIndex]);

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
  }, [pastedImages.length, pushLine, abortRef, setPrompt, setHistoryIndex, setPastedImages]);

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
  }, [paletteOpen, filteredCommands, paletteIndex, paletteState.mode, paletteParentCmd, setPrompt]);

  return { handleUpArrow, handleDownArrow, handleEscape, handleTab };
}

// ── onSubmit with autocomplete logic ───────────────────────────────────

export function useSubmitWithAutocomplete(
  state: TuiState,
  submit: (v?: string) => Promise<void>,
) {
  const {
    prompt, setPrompt,
    paletteOpen, filteredCommands, paletteIndex,
    paletteState, paletteParentCmd,
  } = state;

  return useCallback((v?: string) => {
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
  }, [prompt, setPrompt, paletteOpen, filteredCommands, paletteIndex, paletteState, paletteParentCmd, submit]);
}
