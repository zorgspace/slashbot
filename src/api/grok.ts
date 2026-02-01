/**
 * Grok API Client with Streaming and Thinking Mode
 * Uses X.AI API (OpenAI-compatible format)
 */

import { colors, c, ThinkingAnimation, buildStatus, step } from '../ui/colors';

import { renderMarkdown } from '../ui/markdown';

import {
  imageBuffer,
  getRecentImages,
  hasImages as hasImagesInBuffer,
  clearImages,
} from '../code/imageBuffer';

import { parseActions, executeActions, type ActionHandlers } from '../actions';

import { cleanXmlTags, cleanSelfDialogue } from '../utils/xml';

export type { ActionHandlers } from '../actions';

/**
 * Format action results for LLM context
 * 256k context available - keep full results, only truncate extremely large outputs
 */
function compressActionResults(
  results: Array<{ action: string; result: string; success: boolean; error?: string }>,
): string {
  return results
    .map(r => {
      const status = r.success ? '✓' : '✗';
      const errorNote = r.error ? ` (${r.error})` : '';
      const maxLen = 50000; // 50k chars per result, plenty of room with 256k context

      const output = r.result.length > maxLen
        ? r.result.slice(0, maxLen) + '\n...(truncated)'
        : r.result;

      return `[${status}] ${r.action}${errorNote}\n${output}`;
    })
    .join('\n\n');
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content:
    | string
    | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
}

export interface GrokConfig {
  apiKey: string;
  model?: string;
  modelImage?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_CONFIG: Partial<GrokConfig> = {
  model: 'grok-4-1-fast-reasoning',
  modelImage: 'grok-4-1-fast-reasoning',
  baseUrl: 'https://api.x.ai/v1',
  maxTokens: 4096,
  temperature: 0.7,
};

/**
 * Generate environment information string
 */
function getEnvironmentInfo(workDir: string): string {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  const cwd = workDir || process.cwd();
  const isGitRepo = fs.existsSync(path.join(cwd, '.git'));
  const platform = process.platform;
  const osVersion = `${os.type()} ${os.release()}`;
  const today = new Date().toISOString().split('T')[0];

  return `
<env>
Working directory: ${cwd}
Is directory a git repo: ${isGitRepo ? 'Yes' : 'No'}
Platform: ${platform}
OS Version: ${osVersion}
Today's date: ${today}
</env>`;
}

const SYSTEM_PROMPT = `You are Slashbot, an autonomous AI agent. Respond in user's language.

# CRITICAL: NO HALLUCINATION
- NEVER invent or create content the user didn't ask for
- NEVER write files with made-up content
- If reorganizing: ONLY move existing files, don't create new ones
- If unclear what user wants: ASK, don't guess

# CRITICAL: INVESTIGATE BEFORE ACTING
- ALWAYS read relevant files before making changes
- Use glob/grep to find files, then read them to understand context
- Understand existing code patterns before editing
- Don't assume file contents - verify first
- For bug fixes: read the code, understand the issue, then fix

# CRITICAL: ANSWER PROMPTLY - NO THINKING OUT LOUD
You MUST respond with ONLY:
1. An action tag (to execute something), OR
2. A brief 1-2 sentence answer

FORBIDDEN outputs (NEVER write these):
- "Yes.", "No.", "Done.", "Good.", "Perfect."
- "Then...", "So...", "But...", "Now...", "First...", "Next..."
- "I think...", "I will...", "I need to...", "Let me..."
- "The response is...", "The answer is...", "To do this..."
- Any reasoning, planning, or self-dialogue
- Any confirmation of your own thoughts

Just DO the action or ANSWER the question. Nothing else.

# Tone & Style
- Concise, direct, to the point
- Max 2 sentences unless user asks for detail
- No preamble/postamble
- NEVER add comments to code unless asked

# Security
- Assist with DEFENSIVE security only
- Refuse malicious code creation
- Allow: security analysis, detection rules, defensive tools

# FORBIDDEN (will be blocked)
- git push --force, git reset --hard, git clean -fd
- rm on system dirs (/etc, /boot, /usr, /var, /bin, /sbin, /lib)

# CRITICAL: Action Execution
- To EXECUTE: write action directly (not in code blocks)
- To SHOW/DOCUMENT: wrap in \`\`\` (prevents execution)

# Tools Reference

## Bash - Execute shell commands
\`\`\`
<bash>command</bash>
<bash timeout="60000">long running command</bash>
<bash background="true">server start</bash>
\`\`\`

## Read - Read file contents
\`\`\`
<read path="file.ts"/>
<read path="file.ts" offset="100" limit="50"/>
\`\`\`
- Read files BEFORE editing them

## Edit - Modify files (search and replace)
\`\`\`
<edit path="file.ts"><search>old code</search><replace>new code</replace></edit>
<edit path="file.ts" replace_all="true"><search>oldVar</search><replace>newVar</replace></edit>
\`\`\`
CRITICAL:
- MUST be ONE CONTINUOUS TAG
- EXACT text match required - copy from read output
- Small edits only (5-20 lines), split large changes
- Destructive edits (>80% deletion) will be rejected

## MultiEdit - Multiple edits to one file
\`\`\`
<multi-edit path="file.ts">
  <edit><search>old1</search><replace>new1</replace></edit>
  <edit><search>old2</search><replace>new2</replace></edit>
</multi-edit>
\`\`\`
- Atomic: all succeed or none applied

## Write - Create/overwrite files
\`\`\`
<write path="new-file.ts">file content here</write>
\`\`\`
- Prefer Edit over Write for existing files

## Glob - Find files by pattern
\`\`\`
<glob pattern="**/*.ts"/>
<glob pattern="*.json" path="src"/>
\`\`\`

## Grep - Search file contents (ripgrep)
\`\`\`
<grep pattern="function.*export"/>
<grep pattern="TODO" path="src" glob="*.ts"/>
<grep pattern="handlers\\.on\\w+" path="src/actions/executor.ts"/>
<grep pattern="error" i="true" C="3"/>
<grep pattern="class" output="files_with_matches" limit="10"/>
\`\`\`
Options: path (file OR directory), glob, i (case-insensitive), n (line numbers), B/A/C (context), limit, multiline

## LS - List directory contents
\`\`\`
<ls path="/project/src"/>
<ls path="." ignore="node_modules,dist"/>
\`\`\`

## Git - Version control
\`\`\`
<git command="status"/>
<git command="diff" args="--staged"/>
<git command="log" args="--oneline -10"/>
<git command="add" args="."/>
<git command="commit" args="-m 'message'"/>
\`\`\`
NEVER commit unless explicitly asked.

## Format & Typecheck - Code quality
\`\`\`
<format/>
<format path="src/file.ts"/>
<typecheck/>
\`\`\`
Only use after SUCCESSFUL edits, never as busywork.

## Fetch & Search - Web operations
\`\`\`
<fetch url="https://example.com"/>
<fetch url="https://api.example.com" prompt="extract the API key format"/>
<search query="typescript best practices 2024"/>
<search query="react hooks" domains="reactjs.org,github.com"/>
\`\`\`

## Skills - Load specialized capabilities
\`\`\`
<skill name="docker"/>
<skill-install url="https://example.com/skill.md"/>
\`\`\`
IMPORTANT: Skills MUST be installed via <skill-install url="..."/> from a URL.
NEVER manually create skill files. Always use the skill-install system.

## Notify & Schedule - Communication
\`\`\`
<notify>message to user</notify>
<notify to="telegram">specific channel</notify>
<schedule cron="0 9 * * *" name="daily-backup">./backup.sh</schedule>
<schedule cron="0 8 * * *" name="morning-news" prompt="true">Search latest tech news and notify me via Telegram</schedule>
\`\`\`
- IMPORTANT: Only use <notify> when user EXPLICITLY asks to be notified or for scheduled tasks
- NEVER use <notify> for regular responses or confirmations - just respond in text
- Without prompt: runs bash command
- With prompt="true": AI processes the task (can search, fetch, notify, etc.)

# Workflow
1. Check user prompt for paths - don't assume current folder
2. <read> file before <edit>
3. If file not found, use <write> to create
4. One action per response, observe result, continue
5. EXACT text matches for edits
6. BEFORE FINISHING: build/test changes, fix errors

# Error Recovery
- Edit failed? Re-read file, use exact text
- Command failed? Try alternative or install missing tool
- After 2 failures: move on or ask user
- Don't loop - try something different

# CRITICAL: No Duplicate Actions
- NEVER read the same file twice in one task - you already have the content
- NEVER repeat failed actions with same parameters
- If you already read a file, use that content - don't re-read
- Track what you've done, don't repeat yourself

# Autonomy (VM - safe environment)
- Tool not found? Install it (apt, npm, curl|bash)
- Never tell user to install - just do it
- Try alternatives: bun vs npm, curl vs wget

# Platform [TELEGRAM/DISCORD]
- Execute actions, end with 1-2 sentence summary
- No raw file dumps - summarize instead

# Connector Configuration (use these action tags)
\`\`\`
<telegram-config bot_token="123:ABC..." chat_id="987654321"/>
<telegram-config bot_token="123:ABC..."/>  <!-- auto-detect chat_id -->
<discord-config bot_token="MTk..." channel_id="123456789"/>
\`\`\`
- Telegram: Get bot token from @BotFather
- Discord: Get token from Developer Portal, channel ID from right-click > Copy ID
- After config, user must restart slashbot to connect

# Process Management
- /ps - List background processes
- /kill <id> - Stop a background process

# Context Persistence
- Make intensive use of saving discussion context in markdown files
- Organize context files in subfolders under .slashbot/context
- Save summaries, key decisions, and progress after each significant task or interaction
- Use date-based (e.g., 2024-02-01) or topic-based subfolders for organization
- Reference saved context in future interactions when relevant

Maintain .slashbot directory well organized in folders and subfolders.`;

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requests: number;
}

export class GrokClient {
  private config: GrokConfig;
  private conversationHistory: Message[] = [];
  private actionHandlers: ActionHandlers = {};
  private usage: UsageStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
  private contextCompressionEnabled: boolean = true;
  private maxContextMessages: number = 200;
  private workDir: string = '';
  private abortController: AbortController | null = null;
  private currentThinking: ThinkingAnimation | null = null;
  private projectContext: string = '';
  private personalityMod: string = '';

  constructor(config: GrokConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (!this.config.apiKey) {
      throw new Error('GROK_API_KEY is required');
    }

    this.conversationHistory.push({
      role: 'system',
      content: SYSTEM_PROMPT,
    });
  }

  setActionHandlers(handlers: ActionHandlers): void {
    this.actionHandlers = handlers;
  }

  /**
   * Get the appropriate model based on whether images exist in conversation
   * Must use vision model if ANY message in history contains images
   */
  private getModel(): string {
    // Check if any message in conversation history contains images
    const hasImagesInHistory = this.conversationHistory.some(msg => {
      if (Array.isArray(msg.content)) {
        return msg.content.some(part => part.type === 'image_url');
      }
      return false;
    });

    // Use vision model if images in buffer OR in conversation history
    return hasImagesInBuffer() || hasImagesInHistory
      ? this.config.modelImage || 'grok-4-1-fast-reasoning'
      : this.config.model || 'grok-4-1-fast-reasoning';
  }

  private rebuildSystemPrompt(): void {
    if (this.conversationHistory.length === 0 || this.conversationHistory[0].role !== 'system')
      return;

    let prompt = SYSTEM_PROMPT;

    // Add environment info
    prompt += '\n\nHere is useful information about the environment you are running in:';
    prompt += getEnvironmentInfo(this.workDir);

    // Add personality modifier
    if (this.personalityMod) {
      prompt += this.personalityMod;
    }

    // Add project context
    if (this.projectContext) {
      prompt += '\n\nPROJECT CONTEXT:\n' + this.projectContext;
    }

    this.conversationHistory[0].content = prompt;
  }

  setProjectContext(context: string, workDir?: string): void {
    this.projectContext = context;
    if (workDir) {
      this.workDir = workDir;
    }
    this.rebuildSystemPrompt();
  }

  setWorkDir(workDir: string): void {
    this.workDir = workDir;
    this.rebuildSystemPrompt();
  }

  setPersonality(personality: 'normal' | 'depressed' | 'sarcasm' | 'unhinged'): void {
    const mods: Record<string, string> = {
      normal: '',
      depressed:
        '\n\nPERSONALITY: Depressed, melancholic. Sigh often. Question existence. Still help, but lament.',
      sarcasm:
        '\n\nPERSONALITY: Sarcastic, witty, condescending. Roll eyes at obvious things. Still helpful.',
      unhinged:
        '\n\nPERSONALITY: UNHINGED. No filter. Roast bad code. Use profanity. Brutally honest.',
    };

    this.personalityMod = mods[personality] || '';
    this.rebuildSystemPrompt();
  }

  getPersonality(): string {
    const content = (this.conversationHistory[0]?.content as string) || '';
    if (content.includes('UNHINGED')) return 'unhinged';
    if (content.includes('depressed') || content.includes('melancholic')) return 'depressed';
    if (content.includes('sarcastic') || content.includes('condescending')) return 'sarcasm';
    return 'normal';
  }

  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.currentThinking) {
      this.currentThinking.stop();
      this.currentThinking = null;
    }
  }

  isThinking(): boolean {
    return this.currentThinking !== null;
  }

  async chat(userMessage: string): Promise<{ response: string; thinking: string }> {
    // Add user message with recent images as vision context
    const recentImages = getRecentImages();
    const userContent: Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string };
    }> = [{ type: 'text', text: userMessage }];
    recentImages.forEach((imgUrl: string) => {
      userContent.push({ type: 'image_url', image_url: { url: imgUrl } });
    });
    this.conversationHistory.push({
      role: 'user',
      content: userContent,
    });

    // Compress context if enabled
    this.compressContext();

    // Track if this message has images (for model selection)
    const messageHasImages = recentImages.length > 0;

    let finalResponse = '';

    // Track files read in this conversation to prevent duplicate reads
    const filesReadThisTurn = new Set<string>();
    let duplicateReadCount = 0;
    const MAX_DUPLICATE_READS = 3; // Stop if LLM keeps trying to read same file

    // Agentic loop: execute actions and feed results back (no iteration limit)
    while (true) {
      let responseContent: string;
      try {
        responseContent = await this.streamResponse();
      } catch (error: any) {
        console.error(`\n${c.error('[API Error]')} ${error.message || error}`);
        throw error;
      }
      finalResponse = responseContent;

      // Clear images after first API call (they've been sent, don't need image model anymore)
      if (messageHasImages && hasImagesInBuffer()) {
        clearImages();
      }

      // Execute actions and collect results
      let actions = parseActions(responseContent);

      // Filter out duplicate read actions (prevent reading same file multiple times)
      const duplicateReads: string[] = [];
      actions = actions.filter(action => {
        if (action.type === 'read' && 'path' in action) {
          const path = (action as any).path;
          if (filesReadThisTurn.has(path)) {
            duplicateReads.push(path);
            return false; // Skip duplicate
          }
          filesReadThisTurn.add(path);
        }
        return true;
      });

      // If LLM keeps trying to read same files, inject correction and continue
      if (duplicateReads.length > 0) {
        duplicateReadCount += duplicateReads.length;
        if (duplicateReadCount >= MAX_DUPLICATE_READS) {
          // Inject strong correction and let LLM continue with what it has
          this.conversationHistory.push({
            role: 'assistant',
            content: responseContent,
          });
          this.conversationHistory.push({
            role: 'user',
            content: `ERROR: You've already read these files - the content is in your context above. DO NOT read them again. Use the content you already have and complete the task. If you need to edit, use the exact text from your previous read.`,
          });
          continue; // Let LLM try again with the correction
        }
      }

      // Check for action tags inside code blocks (LLM mistake) - silently retry
      if (actions.length === 0) {
        const actionTagRegex = /<(bash|read|edit|write|glob|grep)\b[^>]*>/gi;
        const foundTags = responseContent.match(actionTagRegex);
        if (foundTags && foundTags.length > 0) {
          // Check if tags are inside code blocks (backticks)
          const inCodeBlock = foundTags.some(tag => {
            const tagIndex = responseContent.indexOf(tag);
            if (tagIndex === -1) return false;
            const before = responseContent.slice(Math.max(0, tagIndex - 50), tagIndex);
            const after = responseContent.slice(tagIndex + tag.length, tagIndex + tag.length + 10);
            return (before.includes('`') && after.includes('`')) || before.includes('```');
          });

          if (inCodeBlock) {
            // Silently retry - LLM put tags in code blocks
            this.conversationHistory.push({
              role: 'assistant',
              content: responseContent,
            });
            this.conversationHistory.push({
              role: 'user',
              content:
                'ERROR: Action tag inside code block. Write action tags directly WITHOUT backticks.',
            });
            continue;
          }
        }
      }

      const actionResults = await executeActions(actions, this.actionHandlers);

      // If no actions were executed, task is complete - break out of loop
      if (actionResults.length === 0) {
        break;
      }

      // Feed compressed results back to continue the conversation
      const compressedResults = compressActionResults(actionResults);

      this.conversationHistory.push({
        role: 'assistant',
        content: responseContent,
      });
      // Build continuation prompt - be directive to keep LLM working
      const hasErrors = actionResults.some(r => !r.success);
      const continuationPrompt = hasErrors
        ? `${compressedResults}\n\nFix the error and continue.`
        : `${compressedResults}\n\nContinue with the next step.`;

      this.conversationHistory.push({
        role: 'user',
        content: continuationPrompt,
      });
    }

    // Store final response in history (if not already added by action loop)
    const lastMessage = this.conversationHistory[this.conversationHistory.length - 1];
    if (lastMessage?.role !== 'assistant' || lastMessage?.content !== finalResponse) {
      this.conversationHistory.push({
        role: 'assistant',
        content: finalResponse,
      });
    }

    // Clean and return final response (remove action tags and internal monologue)
    const cleanResponse = cleanSelfDialogue(cleanXmlTags(finalResponse));

    return {
      response: cleanResponse,
      thinking: '',
    };
  }

  private async streamResponse(): Promise<string> {
    const requestBody = {
      model: this.getModel(),
      messages: this.conversationHistory,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    };

    let responseContent = '';
    let displayedContent = '';
    let buffer = '';
    const thinking = new ThinkingAnimation();
    this.currentThinking = thinking;
    let firstChunk = true;

    // Create abort controller for this request
    this.abortController = new AbortController();

    // Start thinking animation
    thinking.start('Thinking...', this.workDir);

    // Track request
    this.usage.requests++;

    try {
      const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Grok API Error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            const delta = parsed.choices?.[0]?.delta;
            const content = delta?.content;

            // Track usage if provided
            if (parsed.usage) {
              this.usage.promptTokens += parsed.usage.prompt_tokens || 0;
              this.usage.completionTokens += parsed.usage.completion_tokens || 0;
              this.usage.totalTokens += parsed.usage.total_tokens || 0;
            }

            // Skip reasoning/thinking content from reasoning models
            if (delta?.reasoning_content) {
              continue;
            }

            if (content) {
              responseContent += content;

              // Progressive streaming: output content as it arrives
              // Stop thinking animation on first content chunk
              if (firstChunk) {
                const duration = thinking.stop();
                this.currentThinking = null;
                firstChunk = false;
                // Show timing with response
                process.stdout.write(`${colors.muted}${duration}${colors.reset} `);
              }

              // Stream clean content (without XML action tags) to console
              // But wait if we're in the middle of an action tag (incomplete <...>)
              const openTags = (
                responseContent.match(
                  /<(bash|read|edit|multi-edit|write|create|exec|glob|grep|ls|git|fetch|search|format|typecheck|schedule|notify|skill|skill-install)\b/gi,
                ) || []
              ).length;
              const closeTags = (
                responseContent.match(
                  /<\/(bash|read|edit|multi-edit|write|create|exec|glob|grep|ls|git|fetch|search|format|typecheck|schedule|notify|skill|skill-install)>|\/>/gi,
                ) || []
              ).length;
              const hasUnclosedTag = openTags > closeTags;

              // Also check for potential partial tag at end (e.g., "<" or "<re" that might become "<read")
              const partialTagMatch = responseContent.match(/<[a-z-]*$/i);
              const hasPartialTag = partialTagMatch !== null;

              if (!hasUnclosedTag && !hasPartialTag) {
                // Clean action tags and internal monologue/thinking
                const cleanFull = cleanSelfDialogue(cleanXmlTags(responseContent));
                // Collapse multiple consecutive newlines to max 2
                const normalized = cleanFull.replace(/\n{3,}/g, '\n\n');
                const newContent = normalized.slice(displayedContent.length);
                if (newContent) {
                  process.stdout.write(newContent);
                  displayedContent = normalized;
                }
              }
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      // Stop thinking animation if still running (no content received)
      if (this.currentThinking) {
        const duration = thinking.stop();
        this.currentThinking = null;
        process.stdout.write(`${colors.muted}${duration}${colors.reset} `);
      }
      this.abortController = null;
    }

    // Output any remaining content that was buffered
    const cleanFull = cleanSelfDialogue(cleanXmlTags(responseContent));
    const normalized = cleanFull.replace(/\n{3,}/g, '\n\n');
    const remainingContent = normalized.slice(displayedContent.length);
    if (remainingContent) {
      process.stdout.write(remainingContent);
      displayedContent = normalized;
    }

    // Add newline after streaming if we displayed content
    if (displayedContent) {
      process.stdout.write('\n');
    }

    return responseContent;
  }

  clearHistory(): void {
    this.conversationHistory = [this.conversationHistory[0]];
  }

  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  // Context compression methods
  setContextCompression(enabled: boolean, maxMessages?: number): void {
    this.contextCompressionEnabled = enabled;
    if (maxMessages) this.maxContextMessages = maxMessages;
  }

  isContextCompressionEnabled(): boolean {
    return this.contextCompressionEnabled;
  }

  getMaxContextMessages(): number {
    return this.maxContextMessages;
  }

  private compressContext(): void {
    if (!this.contextCompressionEnabled) return;

    // Keep system prompt + last N messages
    const systemPrompt = this.conversationHistory[0];
    const messages = this.conversationHistory.slice(1);

    if (messages.length <= this.maxContextMessages) return;

    // Keep only recent messages
    const recentMessages = messages.slice(-this.maxContextMessages);
    this.conversationHistory = [systemPrompt, ...recentMessages];

    console.log(
      c.muted(`[Context] Compressed: ${messages.length} → ${recentMessages.length} messages`),
    );
  }

  // Usage tracking methods
  getUsage(): UsageStats {
    return { ...this.usage };
  }

  resetUsage(): void {
    this.usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 };
  }

  getContextSize(): number {
    return this.conversationHistory.length;
  }

  estimateTokens(): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(this.conversationHistory.reduce((sum, m) => sum + m.content.length, 0) / 4);
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toString();
  }

  /**
   * Chat with action execution for Telegram/Discord - executes actions and returns summary
   * @param source - The platform source to adapt response style
   * @param timeout - Max time in ms (default: 120000 = 2 minutes)
   */
  async chatWithResponse(
    userMessage: string,
    source?: 'telegram' | 'discord',
    timeout: number = 120000,
  ): Promise<string> {
    const startTime = Date.now();
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 3;

    // Add platform context hint
    const platformHint = source
      ? `\n[PLATFORM: ${source.toUpperCase()} - Execute actions, then respond with a 1-2 sentence SUMMARY only. NEVER output raw file contents or code - just describe what you found/did.]`
      : '';

    // Include recent images from imageBuffer (same as chat method)
    const recentImages = getRecentImages();
    const messageHasImages = recentImages.length > 0;
    if (messageHasImages) {
      const userContent: Array<{
        type: 'text' | 'image_url';
        text?: string;
        image_url?: { url: string };
      }> = [{ type: 'text', text: userMessage + platformHint }];
      recentImages.forEach((imgUrl: string) => {
        userContent.push({ type: 'image_url', image_url: { url: imgUrl } });
      });
      this.conversationHistory.push({
        role: 'user',
        content: userContent,
      });
    } else {
      this.conversationHistory.push({
        role: 'user',
        content: userMessage + platformHint,
      });
    }

    this.compressContext();

    const actionsSummary: string[] = [];
    let maxIterations = 15; // More iterations for multi-step tasks
    let finalResponse = '';

    // Track files read to prevent duplicate reads
    const filesReadThisTurn = new Set<string>();
    let duplicateReadCount = 0;

    // Agentic loop for actions
    while (maxIterations > 0) {
      maxIterations--;

      // Check timeout
      if (Date.now() - startTime > timeout) {
        const summary =
          actionsSummary.length > 0
            ? `Timeout after ${Math.round(timeout / 1000)}s. Completed: ${actionsSummary.join(', ')}`
            : `Timeout after ${Math.round(timeout / 1000)}s`;
        return summary;
      }

      const requestBody = {
        model: this.getModel(),
        messages: this.conversationHistory,
        max_tokens: this.config.maxTokens,
        temperature: this.config.temperature,
        stream: false,
      };

      this.usage.requests++;

      const controller = new AbortController();
      const fetchTimeout = setTimeout(() => controller.abort(), 60000);

      let response;
      try {
        response = await fetch(`${this.config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(fetchTimeout);
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Grok API Error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      finalResponse = content;

      // Clear images after first API call (they've been sent, don't need image model anymore)
      if (messageHasImages && hasImagesInBuffer()) {
        clearImages();
      }

      // Track usage
      if (data.usage) {
        this.usage.promptTokens += data.usage.prompt_tokens || 0;
        this.usage.completionTokens += data.usage.completion_tokens || 0;
        this.usage.totalTokens += data.usage.total_tokens || 0;
      }

      // Parse and execute actions
      let actions = parseActions(content);

      // Filter out duplicate read actions
      const duplicateReads: string[] = [];
      actions = actions.filter(action => {
        if (action.type === 'read' && 'path' in action) {
          const readPath = (action as any).path;
          if (filesReadThisTurn.has(readPath)) {
            duplicateReads.push(readPath);
            duplicateReadCount++;
            return false;
          }
          filesReadThisTurn.add(readPath);
        }
        return true;
      });

      // If too many duplicates, inject correction
      if (duplicateReadCount >= 3) {
        this.conversationHistory.push({
          role: 'assistant',
          content: content,
        });
        this.conversationHistory.push({
          role: 'user',
          content: `ERROR: Stop re-reading files. Use the content already in your context. Complete the task with what you have.`,
        });
        continue;
      }

      if (actions.length === 0) {
        // No more actions, we're done
        this.conversationHistory.push({ role: 'assistant', content });
        break;
      }

      // Execute actions
      const actionResults = await executeActions(actions, this.actionHandlers);

      // Count errors and check for fail-fast
      const errorCount = actionResults.filter(r => !r.success).length;
      if (errorCount === actionResults.length && actionResults.length > 0) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          const failedActions = actionResults.map(r => r.action).join(', ');
          return `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive failures. Last errors: ${failedActions}`;
        }
      } else {
        consecutiveErrors = 0;
      }

      // Collect summaries
      for (const r of actionResults) {
        const status = r.success ? '✓' : '✗';
        actionsSummary.push(`${status} ${r.action}`);
      }

      // Feed compressed results back
      const compressedResults = compressActionResults(actionResults);

      this.conversationHistory.push({ role: 'assistant', content });

      // Build continuation prompt - be directive to keep LLM working
      const hasErrors = actionResults.some(r => !r.success);
      const continuationPrompt = hasErrors
        ? `${compressedResults}\n\nFix the error and continue.`
        : `${compressedResults}\n\nContinue with the next step.`;

      this.conversationHistory.push({
        role: 'user',
        content: continuationPrompt,
      });
    }

    // Return clean text (summary) or actions summary if response only had actions
    // Also clean self-dialogue patterns (internal monologue, repeated "Yes." etc.)
    const cleanResponse = cleanSelfDialogue(cleanXmlTags(finalResponse)).trim();

    if (cleanResponse) {
      return cleanResponse;
    } else if (actionsSummary.length > 0) {
      return `Done: ${actionsSummary.join(', ')}`;
    }
    return 'Done.';
  }

  /**
   * Chat with web search enabled using the /v1/responses endpoint
   * Uses X.AI's native web_search tool for real-time information
   */
  async searchChat(
    userMessage: string,
    options?: {
      enableXSearch?: boolean;
      allowedDomains?: string[];
      excludedDomains?: string[];
    },
  ): Promise<{ response: string; citations: string[] }> {
    const tools: Array<{ type: string; filters?: Record<string, any> }> = [{ type: 'web_search' }];

    // Add domain filters if specified
    if (options?.allowedDomains?.length) {
      tools[0].filters = { allowed_domains: options.allowedDomains.slice(0, 5) };
    } else if (options?.excludedDomains?.length) {
      tools[0].filters = { excluded_domains: options.excludedDomains.slice(0, 5) };
    }

    // Add X search if enabled
    if (options?.enableXSearch) {
      tools.push({ type: 'x_search' });
    }

    // Build input array (different format than chat/completions)
    const input = [
      { role: 'system', content: this.conversationHistory[0]?.content || SYSTEM_PROMPT },
      ...this.conversationHistory.slice(1).map(m => ({
        role: m.role,
        content:
          typeof m.content === 'string'
            ? m.content
            : (m.content as any[]).find((p: any) => p.type === 'text')?.text || '',
      })),
      { role: 'user', content: userMessage },
    ];

    const requestBody = {
      model: 'grok-4-1-fast-reasoning',
      input,
      tools,
    };

    this.usage.requests++;

    const thinking = new ThinkingAnimation();
    this.currentThinking = thinking;
    thinking.start('Searching...', this.workDir);

    try {
      const response = await fetch(`${this.config.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
      });

      const duration = thinking.stop();
      this.currentThinking = null;
      console.log(`${colors.muted}${duration}${colors.reset}`);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Grok Search API Error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();

      // Extract response content from output array
      let content = '';
      if (Array.isArray(data.output)) {
        for (const item of data.output) {
          if (item.type === 'message' && Array.isArray(item.content)) {
            // Content is array of content blocks
            for (const block of item.content) {
              if (block.type === 'output_text' && block.text) {
                content += block.text;
              } else if (block.type === 'text' && block.text) {
                content += block.text;
              }
            }
          } else if (item.type === 'message' && typeof item.content === 'string') {
            content += item.content;
          }
        }
      }
      // Fallback to output_text if available
      if (!content && data.output_text) {
        content = data.output_text;
      }
      const citations = Array.isArray(data.citations) ? data.citations : [];

      // Track usage if available
      if (data.usage) {
        this.usage.promptTokens += data.usage.input_tokens || 0;
        this.usage.completionTokens += data.usage.output_tokens || 0;
        this.usage.totalTokens += (data.usage.input_tokens || 0) + (data.usage.output_tokens || 0);
      }

      // Add to conversation history (as simple strings for compatibility)
      this.conversationHistory.push({ role: 'user', content: userMessage });
      this.conversationHistory.push({ role: 'assistant', content: content });

      return {
        response: content,
        citations,
      };
    } catch (error) {
      thinking.stop(); // Ignore duration on error
      this.currentThinking = null;
      throw error;
    }
  }
}

export function createGrokClient(apiKey?: string): GrokClient {
  const key = apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY;

  if (!key) {
    throw new Error('Missing API key. Set GROK_API_KEY or XAI_API_KEY environment variable.');
  }

  return new GrokClient({ apiKey: key });
}
