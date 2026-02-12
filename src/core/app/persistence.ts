import * as fs from 'fs';
import * as path from 'path';
import type { Message } from '../api/types';
import { getLocalHistoryFile, getLocalSlashbotDir } from '../config/constants';

const MAX_HISTORY_ENTRIES = 500;

function parseHistoryLine(line: string): string {
  // JSON-encoded lines (new format) vs plain text (old format)
  try {
    const parsed = JSON.parse(line);
    return typeof parsed === 'string' ? parsed : line;
  } catch {
    return line;
  }
}

export async function loadHistoryFromDisk(): Promise<string[]> {
  try {
    const historyPath = getLocalHistoryFile();
    const file = Bun.file(historyPath);
    if (!(await file.exists())) {
      return [];
    }

    const content = await file.text();
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(parseHistoryLine);
  } catch {
    return [];
  }
}

export async function writeHistoryToDisk(history: string[]): Promise<void> {
  const configDir = getLocalSlashbotDir();
  await fs.promises.mkdir(configDir, { recursive: true });

  const historyToSave = history.slice(-MAX_HISTORY_ENTRIES);
  await Bun.write(getLocalHistoryFile(), historyToSave.map(h => JSON.stringify(h)).join('\n'));
}

function stringifyContextDumpContent(content: Message['content']): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';

  const lines: string[] = [];
  for (const part of content) {
    if (part.type === 'text') {
      if (part.text) lines.push(part.text);
      continue;
    }
    if (part.type === 'image_url') {
      const url = part.image_url?.url || '';
      lines.push(url ? `[Image] ${url}` : '[Image]');
    }
  }

  return lines.join('\n').trim();
}

function formatContextDumpMessage(msg: Message): string {
  const roleLabel =
    msg.role === 'user'
      ? '### User'
      : msg.role === 'assistant'
        ? '### Assistant'
        : '### Tool/System';

  let body = stringifyContextDumpContent(msg.content);
  if (!body) body = '[Empty message]';

  let section = `${roleLabel}\n\n${body}\n`;

  const toolCalls = (msg as any)._toolCalls;
  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    section += `\n#### Tool Calls\n\n\`\`\`json\n${JSON.stringify(toolCalls, null, 2)}\n\`\`\`\n`;
  }

  if (Array.isArray(msg.toolResults) && msg.toolResults.length > 0) {
    section += `\n#### Tool Results\n\n\`\`\`json\n${JSON.stringify(msg.toolResults, null, 2)}\n\`\`\`\n`;
  }

  return `${section}\n---\n\n`;
}

export async function writeContextDump(
  sessions: Array<{ sessionId: string; history: Message[] }>,
  workDir: string,
): Promise<void> {
  if (sessions.length === 0) return;

  const contextDir = path.join(getLocalSlashbotDir(workDir), 'context');
  if (!fs.existsSync(contextDir)) {
    fs.mkdirSync(contextDir, { recursive: true });
  }

  const now = new Date();
  const datetime = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = path.join(contextDir, `${datetime}.md`);

  let markdown = `# Context Dump - ${now.toLocaleString()}\n\nGenerated: ${now.toISOString()}\n\n`;
  for (const session of sessions) {
    markdown += `## Session: ${session.sessionId}\n\n`;
    for (const msg of session.history) {
      markdown += formatContextDumpMessage(msg);
    }
  }

  await Bun.write(filename, markdown);
}
