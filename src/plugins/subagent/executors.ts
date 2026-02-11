/**
 * Subagent Executor - Spawns child LLM sessions for specialized work
 */

import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { TaskAction } from './types';
import { display, formatToolAction } from '../../core/ui';

/**
 * Execute a subagent task.
 * Creates a lightweight LLM call with restricted context.
 */
export async function executeTask(
  action: TaskAction,
  handlers: ActionHandlers,
): Promise<ActionResult | null> {
  const agentLabel = action.agentType === 'explore' ? 'Explorer' : 'Agent';

  try {
    // For explore tasks, use available handlers to search the codebase
    if (action.agentType === 'explore') {
      return await runExploreAgent(action.prompt, handlers, agentLabel);
    }

    // For general tasks, we currently delegate to explore
    // Full general subagent with its own agentic loop will be a future enhancement
    return await runExploreAgent(action.prompt, handlers, agentLabel);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    display.appendAssistantMessage(
      formatToolAction(`Subagent (${agentLabel})`, action.prompt.slice(0, 80), { success: false, summary: errorMsg }),
    );
    return {
      action: `Task: ${action.prompt.slice(0, 60)}`,
      success: false,
      result: 'Subagent failed',
      error: errorMsg,
    };
  }
}

/**
 * Run an explore-type subagent that uses grep/glob to search the codebase
 */
async function runExploreAgent(prompt: string, handlers: ActionHandlers, agentLabel: string): Promise<ActionResult> {
  const results: string[] = [];

  // Extract search patterns from the prompt
  const searchTerms = extractSearchTerms(prompt);

  for (const term of searchTerms) {
    // Try grep first
    if (handlers.onGrep) {
      try {
        const grepResult = await handlers.onGrep(term, { headLimit: 20 });
        if (grepResult) {
          results.push(`grep "${term}":\n${grepResult}`);
        }
      } catch {
        // Ignore grep errors
      }
    }

    // Try glob for file patterns
    if (handlers.onGlob && (term.includes('*') || term.includes('.'))) {
      try {
        const files = await handlers.onGlob(`**/*${term}*`);
        if (files.length > 0) {
          results.push(`files matching "${term}":\n${files.slice(0, 20).join('\n')}`);
        }
      } catch {
        // Ignore glob errors
      }
    }
  }

  const output =
    results.length > 0 ? results.join('\n\n') : 'No results found for the given search terms.';

  display.appendAssistantMessage(
    formatToolAction(`Subagent (${agentLabel})`, prompt.slice(0, 80), {
      success: true,
      summary: `${results.length} results`,
    }),
  );

  return {
    action: `Task: ${prompt.slice(0, 60)}`,
    success: true,
    result: output,
  };
}

/**
 * Extract search terms from a natural language prompt
 */
function extractSearchTerms(prompt: string): string[] {
  const terms: string[] = [];

  // Extract quoted strings
  const quotedRegex = /["']([^"']+)["']/g;
  let match;
  while ((match = quotedRegex.exec(prompt)) !== null) {
    terms.push(match[1]);
  }

  // Extract likely code identifiers (CamelCase, snake_case)
  const identifierRegex = /\b([A-Z][a-zA-Z0-9]+|[a-z]+_[a-z_]+)\b/g;
  while ((match = identifierRegex.exec(prompt)) !== null) {
    if (!terms.includes(match[1])) {
      terms.push(match[1]);
    }
  }

  // Extract file extensions
  const extRegex = /\.([a-z]{2,4})\b/g;
  while ((match = extRegex.exec(prompt)) !== null) {
    terms.push(`*.${match[1]}`);
  }

  // If no terms extracted, use key words from the prompt
  if (terms.length === 0) {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'and',
      'or',
      'is',
      'are',
      'was',
      'be',
      'how',
      'what',
      'where',
      'find',
      'search',
      'look',
    ]);
    const words = prompt
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));
    terms.push(...words.slice(0, 3));
  }

  return terms.slice(0, 5);
}
