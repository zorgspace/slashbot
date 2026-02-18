import React, { useEffect, useRef, useMemo } from 'react';
import { Box, Text } from 'ink';
import { palette } from './palette.js';
import type { AgentToolAction } from '../core/agentic/llm/index.js';

/** Max tool actions visible in the active list. */
const MAX_VISIBLE_ACTIONS = 5;

export interface AgentLoopDisplayState {
  title: string;
  thoughts: string;
  actions: AgentToolAction[];
  summary: string;
  done: boolean;
}

export interface AgentActivityProps {
  state: AgentLoopDisplayState;
  busy: boolean;
  cols: number;
  displayLabel?: string;
}

function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60_000);
  const secs = Math.round((ms % 60_000) / 1000);
  return `${mins}m${secs.toString().padStart(2, '0')}s`;
}

/** Smart single-value extraction from tool args for preview. */
function argsPreview(action: AgentToolAction, maxLen: number): string {
  const a = action.args;

  // shell.exec: combine command + args
  if (typeof a.command === 'string' && a.command.length > 0) {
    let cmd = a.command;
    if (Array.isArray(a.args)) {
      cmd += ` ${(a.args as string[]).join(' ')}`;
    } else if (typeof a.args === 'string' && a.args.length > 0) {
      cmd += ` ${a.args}`;
    }
    return cmd.length > maxLen ? `${cmd.slice(0, maxLen - 3)}...` : cmd;
  }

  const priorityKeys = ['path', 'file_path', 'filePath', 'url', 'query', 'pattern', 'glob', 'prompt', 'task', 'message', 'name', 'description', 'text', 'content'];
  for (const key of priorityKeys) {
    const val = a[key];
    if (typeof val === 'string' && val.length > 0) {
      return val.length > maxLen ? `${val.slice(0, maxLen - 3)}...` : val;
    }
  }
  // Fallback: first short string value
  for (const val of Object.values(a)) {
    if (typeof val === 'string' && val.length > 0 && val.length <= maxLen) {
      return val;
    }
  }
  return '';
}

/** Extract a short error/result preview. */
function toolOutputPreview(action: AgentToolAction, maxLen = 80): string {
  if (action.status !== 'error') return '';
  const source = action.error ?? '';
  const compact = source.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 3)}...` : compact;
}

/** Build the thin dashed separator line. */
function thinSeparator(cols: number): string {
  const segment = '── ';
  const count = Math.floor(cols / segment.length);
  return segment.repeat(count).trimEnd();
}

// ── Component ─────────────────────────────────────────────────────────

export function AgentActivity({ state, busy, cols, displayLabel }: AgentActivityProps) {
  const startTimesRef = useRef<Map<string, number>>(new Map());
  const doneTimesRef = useRef<Map<string, number>>(new Map());

  // Track start times for new actions, freeze elapsed on completion
  useEffect(() => {
    const starts = startTimesRef.current;
    const dones = doneTimesRef.current;
    for (const action of state.actions) {
      const key = action.id || `${action.toolId}-${state.actions.indexOf(action)}`;
      if (!starts.has(key)) {
        starts.set(key, Date.now());
      }
      if (action.status !== 'running' && !dones.has(key)) {
        dones.set(key, Date.now());
      }
    }
  }, [state.actions]);

  // Memoize separator to avoid recomputing on every frame
  const separator = useMemo(() => thinSeparator(cols - 1), [cols]);

  // ── Done state ────────────────────────────────────────────────────
  if (state.done) {
    const completedCount = state.actions.filter(a => a.status === 'done' || a.status === 'error').length;
    if (completedCount === 0) return null;

    // Calculate total elapsed from first start to last completion
    const starts = [...startTimesRef.current.values()];
    const dones = [...doneTimesRef.current.values()];
    const earliest = starts.length > 0 ? Math.min(...starts) : Date.now();
    const latest = dones.length > 0 ? Math.max(...dones) : Date.now();
    const totalMs = latest - earliest;

    const label = displayLabel || 'Agent';
    const rightText = 'completed';
    const gap = Math.max(1, cols - label.length - rightText.length - 2);

    return (
      <Box flexDirection="column" width={cols} paddingLeft={1}>
        <Box height={1}>
          <Text color={palette.accent} bold>{label}</Text>
          <Text>{' '.repeat(gap)}</Text>
          <Text color={palette.dim}>{rightText}</Text>
        </Box>
        <Box height={1}>
          <Text color={palette.dim}>{separator}</Text>
        </Box>
        <Box height={1}>
          <Text color={palette.success}>
            {`\u2713 ${completedCount} tool${completedCount !== 1 ? 's' : ''} \u00B7 ${formatElapsed(totalMs)}`}
          </Text>
        </Box>
      </Box>
    );
  }

  // ── Hidden state — nothing worth showing yet ─────────────────────
  if (state.actions.length === 0 && !state.thoughts) return null;

  // ── Active state ──────────────────────────────────────────────────
  const visibleActions = state.actions.slice(-MAX_VISIBLE_ACTIONS);
  const totalToolCalls = state.actions.length;
  const doneCount = state.actions.filter(a => a.status === 'done' || a.status === 'error').length;
  const stepNumber = doneCount + (state.actions.some(a => a.status === 'running') ? 1 : 0);

  const label = displayLabel || state.title || 'Agent';
  const rightParts: string[] = [];
  if (stepNumber > 0) rightParts.push(`Step ${stepNumber}`);
  if (totalToolCalls > 0) rightParts.push(`${totalToolCalls} tool${totalToolCalls !== 1 ? 's' : ''}`);
  const rightText = rightParts.join(' \u00B7 ');
  const gap = Math.max(1, cols - label.length - rightText.length - 2);

  return (
    <Box flexDirection="column" width={cols} paddingLeft={1}>
      {/* Header */}
      <Box height={1}>
        <Text color={palette.accent} bold>{label}</Text>
        <Text>{' '.repeat(gap)}</Text>
        <Text color={palette.dim}>{rightText}</Text>
      </Box>

      {/* Thin separator */}
      <Box height={1}>
        <Text color={palette.dim}>{separator}</Text>
      </Box>

      {/* Thoughts line */}
      {state.thoughts && busy ? (
        <Box height={1}>
          <Text color={palette.muted} wrap="truncate-end">
            {state.thoughts.length > cols - 3
              ? `${state.thoughts.slice(0, cols - 6)}...`
              : state.thoughts}
          </Text>
        </Box>
      ) : null}

      {/* Tool action list */}
      {visibleActions.length > 0 ? (
        <Box flexDirection="column" marginTop={state.thoughts && busy ? 1 : 0}>
          {state.actions.length > MAX_VISIBLE_ACTIONS ? (
            <Box height={1} paddingLeft={2}>
              <Text color={palette.dim}>
                {`... ${state.actions.length - MAX_VISIBLE_ACTIONS} more above`}
              </Text>
            </Box>
          ) : null}
          {visibleActions.map((action) => {
            const key = action.id || `${action.toolId}-${state.actions.indexOf(action)}`;
            const startTime = startTimesRef.current.get(key);
            const endTime = doneTimesRef.current.get(key);
            // Running: show live elapsed; done/error: show frozen elapsed
            const elapsed = startTime
              ? (endTime ?? Date.now()) - startTime
              : 0;
            const elapsedStr = formatElapsed(elapsed);
            const displayName = action.toolId || action.name || 'tool';
            const argMaxLen = Math.max(20, cols - displayName.length - elapsedStr.length - 12);
            const args = argsPreview(action, argMaxLen);
            const errorPreview = toolOutputPreview(action, Math.max(40, cols - 8));

            // Right-align elapsed time
            const leftLen = 4 + displayName.length + (args ? 2 + args.length : 0);
            const timeGap = Math.max(1, cols - leftLen - elapsedStr.length - 2);

            return (
              <Box key={key} flexDirection="column">
                <Box height={1}>
                  <Text>{'   '}</Text>
                  {action.status === 'running' ? (
                    <Text color={palette.accent}>{'◐ '}</Text>
                  ) : action.status === 'error' ? (
                    <Text color={palette.error}>{'\u2717 '}</Text>
                  ) : (
                    <Text color={palette.success}>{'\u2713 '}</Text>
                  )}
                  <Text color={palette.text} bold>{displayName}</Text>
                  {args ? <Text color={palette.muted}>{`  ${args}`}</Text> : null}
                  <Text>{' '.repeat(timeGap)}</Text>
                  <Text color={action.status === 'running' ? palette.text : palette.dim}>
                    {elapsedStr}
                  </Text>
                </Box>
                {action.status === 'error' && errorPreview ? (
                  <Box paddingLeft={5} height={1}>
                    <Text color={palette.error} wrap="truncate-end">{errorPreview}</Text>
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}
