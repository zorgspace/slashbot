import { promises as fs, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EventBus } from './event-bus.js';

function debugLog(msg: string): void {
  try { appendFileSync('/tmp/slashbot-ilog.log', `[ilog ${new Date().toISOString()}] ${msg}\n`); } catch {}
}

interface ToolEntry {
  toolId: string;
  args: Record<string, unknown>;
  ok: boolean;
  output: unknown;
  error: string | null;
  at: string;
}

interface InteractionEntry {
  sessionId: string;
  agentId: string;
  source: string;
  receivedAt: string;
  prompt: string;
  tools: ToolEntry[];
  response: string;
  sentAt: string;
}

interface PendingInteraction {
  sessionId: string;
  agentId: string;
  source: string;
  receivedAt: string;
  prompt: string;
  tools: ToolEntry[];
}

function formatDateTime(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}_${h}-${mi}-${s}`;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (truncated, ${text.length} chars total)`;
}

function deriveSource(sessionId: string): string {
  if (sessionId.startsWith('tg-')) return 'telegram';
  if (sessionId.startsWith('dc-')) return 'discord';
  if (sessionId === 'heartbeat') return 'heartbeat';
  return 'tui';
}

function renderMarkdown(entry: InteractionEntry): string {
  const lines: string[] = [];
  lines.push(`# Interaction — ${entry.receivedAt}`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Source | ${entry.source} |`);
  lines.push(`| Session | \`${entry.sessionId}\` |`);
  lines.push(`| Agent | \`${entry.agentId}\` |`);
  lines.push(`| Received | ${entry.receivedAt} |`);
  lines.push(`| Sent | ${entry.sentAt} |`);
  lines.push('');

  lines.push('## Prompt');
  lines.push('');
  lines.push('```');
  lines.push(entry.prompt);
  lines.push('```');
  lines.push('');

  if (entry.tools.length > 0) {
    lines.push(`## Tool Calls (${entry.tools.length})`);
    lines.push('');
    for (let i = 0; i < entry.tools.length; i++) {
      const t = entry.tools[i];
      const icon = t.ok ? '✓' : '✗';
      lines.push(`### ${icon} ${i + 1}. \`${t.toolId}\``);
      lines.push('');
      lines.push('**Args:**');
      lines.push('```json');
      lines.push(truncate(JSON.stringify(t.args, null, 2), 4000));
      lines.push('```');
      lines.push('');
      if (t.ok) {
        lines.push('**Output:**');
        lines.push('```');
        const out = typeof t.output === 'string' ? t.output : JSON.stringify(t.output, null, 2);
        lines.push(truncate(out ?? '(no output)', 8000));
        lines.push('```');
      } else {
        lines.push(`**Error:** ${t.error ?? 'unknown'}`);
      }
      lines.push('');
    }
  }

  lines.push('## Response');
  lines.push('');
  lines.push(entry.response);
  lines.push('');

  return lines.join('\n');
}

/**
 * Subscribes to kernel events and writes a markdown log file
 * to `{logsDir}/{datetime}-{source}.md` for each completed interaction.
 *
 * Captures: prompt, all tool calls with full args/output, and final response.
 */
export function attachInteractionLogger(events: EventBus, logsDir: string): () => void {
  debugLog(`attached, logsDir=${logsDir}`);
  const pending = new Map<string, PendingInteraction>();

  const unsubReceived = events.subscribe('lifecycle:message_received', (event) => {
    const p = event.payload as Record<string, unknown>;
    const sessionId = typeof p.sessionId === 'string' ? p.sessionId : 'unknown';
    const agentId = typeof p.agentId === 'string' ? p.agentId : 'unknown';
    const message = typeof p.message === 'string' ? p.message : '';
    debugLog(`received sessionId=${sessionId} agentId=${agentId} prompt=${message.slice(0, 80)}`);

    pending.set(sessionId, {
      sessionId,
      agentId,
      source: deriveSource(sessionId),
      receivedAt: event.at,
      prompt: message,
      tools: [],
    });
  });

  const unsubToolResult = events.subscribe('tool:result', (event) => {
    const p = event.payload as Record<string, unknown>;
    const sessionId = typeof p.sessionId === 'string' ? p.sessionId : '';
    const toolId = typeof p.toolId === 'string' ? p.toolId : 'unknown';
    const ok = p.ok === true;
    const output = p.output ?? null;
    const error = typeof p.error === 'string' ? p.error : null;
    const args = (p.args && typeof p.args === 'object' && !Array.isArray(p.args))
      ? p.args as Record<string, unknown>
      : {};

    // Match by sessionId first; fall back to attaching to all pending (for tool calls
    // that don't carry a sessionId in their context).
    const entry = pending.get(sessionId);
    if (entry) {
      entry.tools.push({ toolId, args, ok, output, error, at: event.at });
    } else {
      for (const e of pending.values()) {
        e.tools.push({ toolId, args, ok, output, error, at: event.at });
      }
    }
  });

  const unsubSent = events.subscribe('lifecycle:message_sent', (event) => {
    const p = event.payload as Record<string, unknown>;
    const sessionId = typeof p.sessionId === 'string' ? p.sessionId : 'unknown';
    const message = typeof p.message === 'string' ? p.message : '';
    debugLog(`sent sessionId=${sessionId} pending=${pending.has(sessionId)} response=${message.slice(0, 80)}`);

    const entry = pending.get(sessionId);
    if (!entry) return;
    pending.delete(sessionId);

    const interaction: InteractionEntry = {
      ...entry,
      response: message,
      sentAt: event.at,
    };

    void writeLog(logsDir, interaction);
  });

  return () => {
    unsubReceived();
    unsubToolResult();
    unsubSent();
  };
}

async function writeLog(logsDir: string, entry: InteractionEntry): Promise<void> {
  try {
    await fs.mkdir(logsDir, { recursive: true });
    const now = new Date();
    const filename = `${formatDateTime(now)}-${entry.source}-${now.getTime() % 10000}.md`;
    await fs.writeFile(join(logsDir, filename), renderMarkdown(entry), 'utf8');
  } catch {
    // Best-effort — never crash the app for logging
  }
}
