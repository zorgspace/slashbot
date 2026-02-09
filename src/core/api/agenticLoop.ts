/**
 * Agentic Loop - Iterative action execution loop for both CLI and connector modes
 */

import { display } from '../ui';
import { parseActions, executeActions, type ActionResult } from '../actions';
import { compressActionResults } from './utils';
import { streamResponse } from './streaming';
import type { ClientContext, AgenticLoopOptions, AgenticLoopResult } from './types';

/**
 * Run the agentic loop: stream LLM response, parse actions, execute, feed results back.
 */
export async function runAgenticLoop(
  ctx: ClientContext,
  messageHasImages: boolean,
  opts: AgenticLoopOptions,
): Promise<AgenticLoopResult> {
  const imageBufferMod = await import('../code/imageBuffer');
  const hasImagesInBuffer = imageBufferMod.hasImages;
  const clearImages = imageBufferMod.clearImages;

  const executedActions: Array<{ type: string; description: string; success: boolean }> = [];
  const actionsSummary: string[] = [];
  let finalResponse = '';
  let finalThinking = '';
  let endMessage: string | undefined;
  let emptyResponseRetries = 0;
  const MAX_EMPTY_RETRIES = 2;
  let forcedRetryAttempted = false;
  let iteration = 0;
  let isFirstIteration = true;
  let consecutiveErrors = 0;
  let truncatedContent = '';
  const startTime = Date.now();

  // Edit safety guards
  const unresolvedEditPaths = new Set<string>();
  let blockedEndCount = 0;
  const MAX_BLOCKED_ENDS = 2;
  const readFiles = new Map<string, 'full' | 'partial'>();

  while (true) {
    iteration++;

    // Overall timeout check
    if (opts.overallTimeout && Date.now() - startTime > opts.overallTimeout) {
      if (ctx.thinkingActive) {
        display.stopThinking();
        ctx.thinkingActive = false;
      }
      display.endThinkingStream();
      const summary =
        actionsSummary.length > 0
          ? `Timeout after ${Math.round(opts.overallTimeout / 1000)}s. Completed: ${actionsSummary.join(', ')}`
          : `Timeout after ${Math.round(opts.overallTimeout / 1000)}s`;
      return {
        finalResponse,
        finalThinking,
        executedActions,
        actionsSummary,
        timedOut: true,
        earlyReturn: summary,
      };
    }

    let responseContent: string;
    let thinkingContent: string;
    let finishReason: string | null = null;

    try {
      const result = await streamResponse(ctx, {
        showThinking: isFirstIteration,
        displayStream: opts.displayStream,
        timeout: opts.iterationTimeout,
        thinkingLabel: opts.displayStream ? 'Reflection...' : 'Thinking...',
      });
      isFirstIteration = false;
      responseContent = result.content;
      thinkingContent = result.thinking;
      finishReason = result.finishReason;

      if (opts.displayStream) {
        responseContent = responseContent.replace(/``/g, '');
      }
    } catch (error: any) {
      if (
        opts.tokenLimitStrategy === 'condense' &&
        error.message?.includes('maximum prompt length')
      ) {
        display.warningText(
          '[Token limit reached] Creating condensed context and coming back fresh...',
        );

        const condensedSummary = ctx.sessionManager.condenseHistory();
        display.muted(
          `[Context] Condensed ${ctx.sessionManager.history.length} messages into 1 summary`,
        );

        ctx.sessionManager.history = [
          ctx.sessionManager.history[0],
          { role: 'user', content: condensedSummary },
        ];

        try {
          const result = await streamResponse(ctx, { displayStream: opts.displayStream });
          responseContent = result.content;
          thinkingContent = result.thinking;
          finishReason = result.finishReason;
        } catch (retryError: any) {
          display.errorText(`[API Error after condensation] ${retryError.message || retryError}`);
          throw retryError;
        }
      } else if (error.name === 'TokenModeError') {
        display.violet(`[ERROR] ${error.message}`);
        display.violet(error.details);
        throw error;
      } else {
        display.errorText(`[API Error] ${error.message || error}`);
        throw error;
      }
    }

    // Merge with previously truncated content
    if (truncatedContent) {
      responseContent = truncatedContent + responseContent;
      truncatedContent = '';
    }

    finalResponse = responseContent;
    finalThinking += thinkingContent;

    // Clear images after first API call
    if (messageHasImages && hasImagesInBuffer()) {
      clearImages();
    }

    // Auto-continue on truncated edit/write (regardless of finish_reason)
    const hasUnclosedEdit =
      /<edit\b[^>]*>/i.test(responseContent) && !/<\/edit>/i.test(responseContent);
    const hasUnclosedWrite =
      /<write\b[^>]*>/i.test(responseContent) && !/<\/write>/i.test(responseContent);
    if (hasUnclosedEdit || hasUnclosedWrite) {
      const tag = hasUnclosedEdit ? 'edit' : 'write';
      truncatedContent = responseContent;
      ctx.sessionManager.history.push({ role: 'assistant', content: responseContent });
      ctx.sessionManager.history.push({
        role: 'user',
        content: `Your response was truncated mid-<${tag}> block (output token limit reached). Continue EXACTLY where you left off — output only the remaining content to complete the <${tag}> block and close it with </${tag}>.`,
      });
      continue;
    }
    if (finishReason === 'length') {
      display.muted(`[finish_reason: length] Response may be truncated`);
    }

    // Parse actions
    let actions = parseActions(responseContent);

    // Deduplicate actions from truncation auto-continue accumulation
    {
      const dupeIndices = new Map<string, number[]>();
      actions.forEach((a, i) => {
        const path = a.path as string | undefined;
        if (path && (a.type === 'write' || a.type === 'create' || a.type === 'plan-ready')) {
          const key = a.type + ':' + path;
          if (!dupeIndices.has(key)) dupeIndices.set(key, []);
          dupeIndices.get(key)!.push(i);
        }
      });
      const drop = new Set<number>();
      for (const [key, indices] of dupeIndices) {
        if (indices.length <= 1) continue;
        const keep = key.startsWith('plan-ready:') ? indices.slice(1) : indices.slice(0, -1);
        keep.forEach(i => drop.add(i));
      }
      if (drop.size > 0) {
        actions = actions.filter((_, i) => !drop.has(i));
      }
    }

    // Read tracking: update readFiles map from parsed actions
    for (const action of actions) {
      if (action.type === 'read') {
        const path = (action as { path?: string }).path;
        if (path) {
          const hasOffset = (action as { offset?: number }).offset !== undefined;
          const hasLimit = (action as { limit?: number }).limit !== undefined;
          const coverage = hasOffset || hasLimit ? 'partial' : 'full';
          if (readFiles.get(path) !== 'full') {
            readFiles.set(path, coverage);
          }
        }
      }
    }

    // Edit validation: reject edits on files not fully read
    const syntheticResults: ActionResult[] = [];
    const filteredActions = actions.filter(action => {
      if (action.type === 'edit') {
        const path = (action as { path?: string }).path;
        if (path && readFiles.get(path) !== 'full') {
          const wasPartial = readFiles.get(path) === 'partial';
          syntheticResults.push({
            action: `Edit: ${path}`,
            success: false,
            result: 'Blocked',
            error: wasPartial
              ? `Cannot edit ${path} — you only read part of this file. Use <read path="${path}"/> (without offset/limit) to read the entire file first, then retry the <edit>.`
              : `Cannot edit ${path} — you have not read this file yet. Use <read path="${path}"/> first, then retry the <edit> using the exact content and line numbers from the <read> output.`,
          });
          return false;
        }
      }
      return true;
    });

    const executedResults = await executeActions(filteredActions, ctx.actionHandlers);
    const actionResults = [...syntheticResults, ...executedResults];

    // Track unresolved edit failures
    for (const r of actionResults) {
      const action = String(r.action ?? '');
      if (action.startsWith('Edit:')) {
        const path = action.replace(/^Edit:\s*/, '').trim();
        if (r.success) {
          unresolvedEditPaths.delete(path);
        } else {
          unresolvedEditPaths.add(path);
        }
      } else if (action.startsWith('Write:') && r.success) {
        const path = action.replace(/^Write:\s*/, '').trim();
        unresolvedEditPaths.delete(path);
      }
    }

    // Continue action support
    if (opts.continueActions) {
      const hasContinueAction = actions.some(a => a.type === 'continue');
      if (hasContinueAction) {
        iteration = 0;
        ctx.sessionManager.history.push({ role: 'assistant', content: responseContent });
        ctx.sessionManager.history.push({
          role: 'user',
          content: `Continuing task as requested by <continue> action.\n\n${compressActionResults(actionResults)}\n\n<system-instruction>Continue the task.</system-instruction>`,
        });
        continue;
      }
    }

    // Hard limit
    if (iteration >= opts.maxIterations) {
      ctx.sessionManager.history.push({ role: 'assistant', content: responseContent });
      break;
    }

    // Plan-ready action: break loop, signal plan completion
    const planReadyResult = actionResults.find(r => r.action === 'PlanReady');
    if (planReadyResult) {
      ctx.sessionManager.history.push({ role: 'assistant', content: responseContent });
      break;
    }

    // End action: block if unresolved edit failures remain
    const endResult = actionResults.find(r => r.action === 'End');
    if (endResult) {
      if (unresolvedEditPaths.size > 0 && blockedEndCount < MAX_BLOCKED_ENDS) {
        blockedEndCount++;
        const failedList = Array.from(unresolvedEditPaths).join(', ');
        ctx.sessionManager.history.push({ role: 'assistant', content: responseContent });
        ctx.sessionManager.history.push({
          role: 'user',
          content: [
            `BLOCKED: You cannot finish — the following files have unresolved edit failures: ${failedList}`,
            '',
            'You MUST either:',
            '1. Retry the edit using EXACT content from the <read> output already in your context (do NOT re-read the file)',
            '2. Use <write> to overwrite the file if the edit is too complex',
            '3. Honestly acknowledge in your <end> message that the edit could not be applied',
            '',
            'Do NOT claim success when edits have failed.',
          ].join('\n'),
        });
        continue;
      }
      if (endResult.result) {
        display.sayResult(endResult.result);
        endMessage = endResult.result;
      }
      ctx.sessionManager.history.push({ role: 'assistant', content: responseContent });
      break;
    }

    // Say action: display message but continue the loop
    const hasSayAction = actionResults.some(r => r.action === 'Says');
    if (hasSayAction) {
      const sayResult = actionResults.find(r => r.action === 'Says');
      if (sayResult?.result) {
        display.sayResult(sayResult.result);
      }
    }

    // Consecutive error tracking (connector mode)
    if (opts.maxConsecutiveErrors !== undefined) {
      const errorCount = actionResults.filter(r => !r.success).length;
      if (errorCount === actionResults.length && actionResults.length > 0) {
        consecutiveErrors++;
        if (consecutiveErrors >= opts.maxConsecutiveErrors) {
          const failedActions = actionResults.map(r => r.action).join(', ');
          const errorMsg = `Stopped after ${opts.maxConsecutiveErrors} consecutive failures. Last errors: ${failedActions}`;
          display.errorText(errorMsg);
          if (ctx.thinkingActive) {
            display.stopThinking();
            ctx.thinkingActive = false;
          }
          display.endThinkingStream();
          return {
            finalResponse,
            finalThinking,
            executedActions,
            actionsSummary,
            timedOut: false,
            earlyReturn: errorMsg,
          };
        }
      } else {
        consecutiveErrors = 0;
      }
    }

    // Cache file contents (CLI mode)
    if (opts.cacheFileContents) {
      for (const result of actionResults) {
        const action = String(result.action ?? '');
        const success = Boolean(result.success);
        executedActions.push({
          type: action.split('(')[0].trim(),
          description: action,
          success,
        });

        if (action.startsWith('Read:') && success && result.result) {
          const filePath = action.replace('Read: ', '').trim();
          if (result.result.length < 50000) {
            ctx.sessionManager.fileContextCache.set(filePath, result.result);
          }
        }
        if (action.startsWith('Edit:') && success && ctx.actionHandlers.onRead) {
          const filePath = action.replace(/^Edit: /, '').trim();
          try {
            const newContent = await ctx.actionHandlers.onRead(filePath);
            if (newContent && newContent.length < 50000) {
              ctx.sessionManager.fileContextCache.set(filePath, newContent);
            }
          } catch {
            // Ignore read errors
          }
        }
        if (action.startsWith('Write:') && success && ctx.actionHandlers.onRead) {
          const filePath = action.replace('Write: ', '').trim();
          try {
            const newContent = await ctx.actionHandlers.onRead(filePath);
            if (newContent && newContent.length < 50000) {
              ctx.sessionManager.fileContextCache.set(filePath, newContent);
            }
          } catch {
            // Ignore read errors
          }
        }
        if (action.startsWith('Grep:') && success && result.result) {
          const grepKey = `grep:${action}`;
          if (result.result.length < 50000) {
            ctx.sessionManager.fileContextCache.set(grepKey, result.result);
          }
        }
      }
    } else {
      // Connector mode: just build summary
      for (const r of actionResults) {
        const status = (r as { success?: boolean }).success ? '✓' : '✗';
        const action = (r as { action?: string }).action ?? '';
        actionsSummary.push(`${status} ${action}`);
      }
    }

    // No actions executed: hallucination detection
    if (actionResults.length === 0) {
      // Empty response retry (CLI mode)
      if (opts.emptyResponseRetry && thinkingContent && !responseContent.trim()) {
        emptyResponseRetries++;
        if (emptyResponseRetries >= MAX_EMPTY_RETRIES) {
          if (forcedRetryAttempted) {
            display.errorText('[Model failed to respond after forced retry - stopping]');
            break;
          }
          display.warningText('[Model stopped producing responses after retries]');
          display.muted('Last thinking: ' + thinkingContent);
          ctx.sessionManager.history.push({
            role: 'assistant',
            content: '[Incomplete - model stopped responding]',
          });
          ctx.sessionManager.history.push({
            role: 'user',
            content:
              'CRITICAL: You stopped mid-task. Your last thought was: ' +
              thinkingContent +
              '. Execute that action NOW or explain what went wrong.',
          });
          forcedRetryAttempted = true;
          continue;
        }
        ctx.sessionManager.history.push({ role: 'assistant', content: '[Thinking...]' });
        ctx.sessionManager.history.push({
          role: 'user',
          content:
            "You were thinking but didn't provide a response. Execute your planned action NOW.",
        });
        continue;
      }

      // Full hallucination detection (CLI mode)
      if (opts.hallucinationDetection === 'full') {
        const hasCloseEdit = /<\/edit/i.test(responseContent);
        const hasProperEditOpen = /<edit\s+path=["'][^"']+["'][^>]*>[\s\S]*?@@ -\d+,\d+ @@/i.test(
          responseContent,
        );
        if (hasCloseEdit && !hasProperEditOpen) {
          ctx.sessionManager.history.push({ role: 'assistant', content: responseContent });
          ctx.sessionManager.history.push({
            role: 'user',
            content: `ERROR: Malformed <edit> tag. You must use the unified diff format exactly:\n\n<edit path="file.ts">\n@@ -startLine,count @@\n-line to remove\n+line to add\n context line (unchanged, starts with a space)\n</edit>\n\n- startLine: 1-based line number from <read> output where this hunk begins.\n- count: number of existing lines this hunk spans (context + removed). Use 0 for pure insertion.\n- Every line inside a hunk MUST start with \` \` (space), \`-\`, or \`+\`.\n\nRead the file first with <read> to see actual line numbers and content.`,
          });
          continue;
        }
      }

      // Code hallucination detection (both modes)
      const codePatterns = [
        /^(async\s+)?(function|class|const|let|var|export|import)\s+/m,
        /constructor\s*\([^)]*\)\s*\{/m,
        /^\s*(public|private|protected)\s+/m,
      ];
      const looksLikeCode = codePatterns.some(p => p.test(responseContent));

      if (looksLikeCode && !responseContent.includes('```')) {
        ctx.sessionManager.history.push({ role: 'assistant', content: responseContent });
        ctx.sessionManager.history.push({
          role: 'user',
          content:
            opts.hallucinationDetection === 'full'
              ? `ERROR: You outputted code directly instead of using actions. NEVER output raw code - always use <read path="..."/> to check actual file content, then <edit path="...">@@ -line,count @@\n-old\n+new\n</edit> to make changes. Do NOT hallucinate file contents from memory.`
              : `ERROR: You outputted code directly instead of using actions. Use <read path="..."/> to check files, then <edit path="...">...</edit> to make changes. Do NOT hallucinate file contents.`,
        });
        continue;
      }

      // No actions, not a hallucination — done
      ctx.sessionManager.history.push({ role: 'assistant', content: responseContent });
      break;
    }

    // Reset retry counters on successful action execution
    emptyResponseRetries = 0;
    forcedRetryAttempted = false;

    // Feed compressed results back to continue the conversation
    const compressedResults = compressActionResults(actionResults);
    ctx.sessionManager.history.push({ role: 'assistant', content: responseContent });

    // Build file context: only filenames (contents already in action-output)
    let fileContext = '';
    if (opts.includeFileContext && ctx.sessionManager.fileContextCache.size > 0) {
      const filenames = Array.from(ctx.sessionManager.fileContextCache.keys()).filter(
        k => !k.startsWith('grep:'),
      );
      if (filenames.length > 0) {
        fileContext = `\nFiles in context: ${filenames.join(', ')}`;
      }
    }

    // Build continuation prompt
    const hasErrors = actionResults.some(r => !r.success);
    const failedEditPaths = actionResults
      .filter(r => !r.success && String(r.action ?? '').startsWith('Edit:'))
      .map(r => String(r.action ?? '').replace(/^Edit:\s*/, '').trim());

    const iterationWarning =
      iteration >= 15
        ? `\n[WARNING] ${iteration} iterations. Use <continue/> or <end> to finish.`
        : '';

    let instruction: string;
    if (hasErrors && failedEditPaths.length > 0) {
      instruction = [
        `EDIT FAILED on: ${failedEditPaths.join(', ')}`,
        'Copy EXACT content from the <read> output that you have on your context for the search.',
      ].join('\n');
    } else if (hasErrors) {
      instruction = 'ERROR DETECTED — fix it now.';
    } else {
      instruction = 'Continue or <end> to finish.';
    }

    const continuationPrompt = `${compressedResults}${fileContext}${iterationWarning}\n${instruction}`;

    ctx.sessionManager.history.push({ role: 'user', content: continuationPrompt });
  }

  return { finalResponse, finalThinking, executedActions, actionsSummary, timedOut: false, endMessage };
}
