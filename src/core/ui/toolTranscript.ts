/**
 * Tool transcript parsing helpers.
 *
 * Converts assistant tool-call transcripts (legacy text format) into
 * normalized entries so TUI rendering stays consistent across code paths.
 */

export type ToolTranscriptEntry =
  | { kind: 'tool'; toolName: string; detail: string; success?: boolean }
  | { kind: 'message'; text: string };

export function humanizeToolName(raw: string): string {
  const cleaned = raw.trim().replace(/[_-]+/g, ' ');
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join(' ');
}

export function summarizeToolResult(raw: string): { success?: boolean; detail: string } {
  const lines = raw
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return { detail: 'completed' };
  }

  let success: boolean | undefined;
  let first = lines[0];
  if (first.startsWith('[✓]')) {
    success = true;
    first = first.slice(3).trim();
  } else if (first.startsWith('[✗]')) {
    success = false;
    first = first.slice(3).trim();
  }

  // Backward compatibility: older bash results started with a generic heading.
  if (/^(command output|directory contents):?$/i.test(first) && lines.length > 1) {
    first = lines[1];
  }

  const detailBase = (first || 'completed').replace(/\s+/g, ' ').slice(0, 160);
  const extra = lines.length > 1 ? ` (+${lines.length - 1} lines)` : '';
  return {
    ...(success === undefined ? {} : { success }),
    detail: `${detailBase}${extra}`,
  };
}

export function parseLegacyToolLine(raw: string): { toolName: string; result: string } {
  const trimmed = raw.trim();
  const match = trimmed.match(/^\[([^\]]+)\]\s*([\s\S]*)$/);
  if (!match) {
    return { toolName: 'tool', result: trimmed };
  }
  return {
    toolName: match[1].trim() || 'tool',
    result: match[2].trim() || 'completed',
  };
}

export function isAssistantToolTranscript(text: string): boolean {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  return lines.some(
    line =>
      line.toLowerCase() === '[tool calls]' ||
      /^\[tool\]\s*\[[^\]]+\]/i.test(line) ||
      /^\[(say_message|end_task|continue_task)\]/i.test(line),
  );
}

export function parseAssistantToolTranscript(text: string): ToolTranscriptEntry[] {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const entries: ToolTranscriptEntry[] = [];
  const messageBuffer: string[] = [];

  const flushMessages = () => {
    if (messageBuffer.length === 0) return;
    entries.push({ kind: 'message', text: messageBuffer.join('\n') });
    messageBuffer.length = 0;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.toLowerCase() === '[tool calls]') {
      continue;
    }

    const toolMatch = line.match(/^\[tool\]\s*\[([^\]]+)\]\s*(.*)$/i);
    if (toolMatch) {
      flushMessages();
      const toolName = humanizeToolName(toolMatch[1]);
      const block: string[] = [toolMatch[2].trim()];
      let j = i + 1;
      while (
        j < lines.length &&
        !/^\[tool\]\s*\[[^\]]+\]/i.test(lines[j]) &&
        !/^\[(say_message|end_task|continue_task)\]/i.test(lines[j])
      ) {
        block.push(lines[j]);
        j++;
      }
      i = j - 1;
      const summary = summarizeToolResult(block.join('\n'));
      entries.push({
        kind: 'tool',
        toolName,
        detail: summary.detail,
        success: summary.success,
      });
      continue;
    }

    const flowMatch = line.match(/^\[(say_message|end_task|continue_task)\]\s*(.*)$/i);
    if (flowMatch) {
      const flowType = flowMatch[1].toLowerCase();
      if (flowType === 'end_task' || flowType === 'continue_task') {
        continue;
      }
      if (flowType === 'say_message') {
        const textLine = flowMatch[2].trim();
        if (textLine && !/^message displayed$/i.test(textLine)) {
          flushMessages();
          entries.push({ kind: 'message', text: textLine });
        }
        continue;
      }

      flushMessages();
      const summary = summarizeToolResult(flowMatch[2] || 'completed');
      entries.push({
        kind: 'tool',
        toolName: humanizeToolName(flowMatch[1]),
        detail: summary.detail,
        success: summary.success,
      });
      continue;
    }

    messageBuffer.push(line);
  }

  flushMessages();
  return entries;
}
