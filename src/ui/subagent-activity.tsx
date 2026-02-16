import React from 'react';
import { Box, Text } from 'ink';
import { palette } from './palette.js';
import { MarkdownText } from './markdown-text.js';
import type { SubagentTask } from '../plugins/services/subagent-manager.js'; // Adjust path if needed, or define inline

// Define SubagentTask if not imported
interface SubagentTaskLocal {
  id: string;
  task: string;
  status: 'running' | 'done' | 'error';
  result?: string;
  error?: string;
}

export interface SubagentActivityProps {
  subagents: SubagentTaskLocal[];
  cols: number;
}

function statusIcon(status: SubagentTaskLocal['status']): string {
  switch (status) {
    case 'running': return '\u22EF';
    case 'done': return '\u2713';
    case 'error': return '\u2717';
  }
}

function statusColor(status: SubagentTaskLocal['status']): string {
  switch (status) {
    case 'running': return palette.accent;
    case 'done': return palette.success;
    case 'error': return palette.error;
  }
}

function taskPreview(task: string, maxLen = 60): string {
  const compact = task.replace(/\s+/g, ' ').trim();
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 3)}...` : compact;
}

function resultPreview(task: SubagentTaskLocal, maxLen = 100): string {
  const source = task.status === 'error' ? (task.error ?? '') : (task.result ?? '');
  const compact = source.replace(/\s+/g, ' ').trim();
  if (!compact) return '';
  return compact.length > maxLen ? `${compact.slice(0, maxLen - 3)}...` : compact;
}

export function SubagentActivity({ subagents, cols }: SubagentActivityProps) {
  if (subagents.length === 0) return null;

  return (
    <Box flexDirection="column" width={cols}>
      <Box height={1} width={cols}>
        <Text color={palette.accent} bold>{'  '}</Text>
        <Text color={palette.accent} bold>{`Subagents (${subagents.length})`}</Text>
      </Box>
      {subagents.map((task) => (
        <Box key={task.id} width={cols} flexDirection="column" paddingLeft={2}>
          <Box height={1} width={cols}>
            <Text color={palette.muted}>{task.id.slice(0,8)} </Text>
            <Text color={statusColor(task.status)}>{statusIcon(task.status)} </Text>
            <Text color={palette.text}>{taskPreview(task.task, cols - 40)}</Text>
          </Box>
          {task.status !== 'running' && resultPreview(task, cols - 10) ? (
            <Box width={cols}>
              <Text color={palette.muted}>{'    '}</Text>
              <MarkdownText
                text={resultPreview(task, cols - 10)}
                color={task.status === 'error' ? palette.error : palette.muted}
                wrap="truncate-end"
              />
            </Box>
          ) : null}
        </Box>
      ))}
    </Box>
  );
}