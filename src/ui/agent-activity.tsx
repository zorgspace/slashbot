import React from 'react';
import { Box, Text } from 'ink';
import { palette } from './palette.js';
import { MarkdownText } from './markdown-text.js';
import type { AgentToolAction } from '../core/agentic/llm/index.js';

/** Show all tool uses in the run (match agent-loop maxSteps). */
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
}

function statusIcon(status: AgentToolAction['status']): string {
  switch (status) {
    case 'running': return '\u22EF';
    case 'done': return '\u2713';
    case 'error': return '\u2717';
  }
}

function statusColor(status: AgentToolAction['status']): string {
  switch (status) {
    case 'running': return palette.accent;
    case 'done': return palette.success;
    case 'error': return palette.error;
  }
}

function toolOutputPreview(action: AgentToolAction, maxLen = 160): string {
  const source = action.status === 'error'
    ? (action.error ?? '')
    : (action.result ?? '');
  const compact = source.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 3)}...` : compact;
}

export function AgentActivity({ state, busy, cols }: AgentActivityProps) {
  // Show a compact one-line summary briefly after completion (before timer clears state).
  if (state.done) {
    const completedCount = state.actions.filter(a => a.status === 'done' || a.status === 'error').length;
    if (completedCount === 0) return null;
    return (
      <Box height={1} width={cols}>
        <Text color={palette.success}>{`  \u2713 ${completedCount} tool${completedCount !== 1 ? 's' : ''} completed`}</Text>
      </Box>
    );
  }

  if (!busy && state.actions.length === 0 && !state.title) return null;

  const visibleActions = state.actions.slice(-MAX_VISIBLE_ACTIONS);
  const totalToolCalls = state.actions.length;
  const currentStep = state.actions.filter(a => a.status === 'done' || a.status === 'error').length;

  return (
    <Box flexDirection="column" width={cols}>
      {state.title ? (
        <Box height={1} width={cols}>
          <Text color={palette.accent} bold>{'  '}</Text>
          <Text color={palette.accent} bold>{state.title}</Text>
        </Box>
      ) : null}

      {state.thoughts && busy ? (
        <Box width={cols}>
          <Text color={palette.muted}>{'  '}</Text>
          <MarkdownText
            text={state.thoughts.length > cols - 6 ? `${state.thoughts.slice(0, cols - 9)}...` : state.thoughts}
            color={palette.muted}
            wrap="truncate-end"
          />
        </Box>
      ) : null}

      {visibleActions.length > 0 ? (
        <Box flexDirection="column" width={cols}>
          {visibleActions.map((action, i) => {
            const argsPreview = Object.entries(action.args)
              .map(([k, v]) => typeof v === 'string' && v.length <= 40 ? v : k)
              .join(' ')
              .slice(0, cols - 30);
            const output = toolOutputPreview(action, Math.max(80, cols - 12));
            const displayName = action.toolId || action.name || 'tool';
            return (
              <Box key={action.id || `action-${i}`} width={cols} flexDirection="column">
                <Box height={1} width={cols}>
                  <Text color={palette.muted}>{'  '}</Text>
                  <Text color={statusColor(action.status)}>{statusIcon(action.status)} </Text>
                  <Text color={palette.text} bold>{displayName}</Text>
                  <Text color={palette.muted}>{argsPreview ? `  ${argsPreview}` : ''}</Text>
                </Box>
                {output ? (
                  <Box width={cols}>
                    <Text color={palette.muted}>{'    '}</Text>
                    <MarkdownText
                      text={output}
                      color={action.status === 'error' ? palette.error : palette.muted}
                      wrap="wrap"
                    />
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>
      ) : null}

      {totalToolCalls > 0 && busy ? (
        <Box height={1} width={cols}>
          <Text color={palette.dim}>{`  Step ${currentStep} \u00B7 ${totalToolCalls} tool${totalToolCalls !== 1 ? 's' : ''} used`}</Text>
        </Box>
      ) : null}

      {state.summary && state.done ? (
        <Box width={cols} marginTop={1}>
          <Text color={palette.muted}>{'  '}</Text>
          <MarkdownText text={state.summary} color={palette.text} wrap="wrap" />
        </Box>
      ) : null}
    </Box>
  );
}
