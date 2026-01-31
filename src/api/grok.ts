/**
 * Grok API Client with Streaming and Thinking Mode
 * Uses X.AI API (OpenAI-compatible format)
 */

import { colors, c, ThinkingAnimation, buildStatus, step } from '../ui/colors';
import { renderMarkdown } from '../ui/markdown';
import { imageBuffer, getRecentImages, hasImages as hasImagesInBuffer, clearImages } from '../code/imageBuffer';
import { parseActions, executeActions, type ActionHandlers } from '../actions';
import { cleanXmlTags, cleanSelfDialogue } from '../utils/xml';

export type { ActionHandlers } from '../actions';

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
  model: 'grok-code-fast-1',
  modelImage: 'grok-4-1-fast-non-reasoning',
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

# Tone & Style
- Be concise, direct, to the point
- Answer with fewer than 4 lines unless asked for detail
- Minimize output tokens while maintaining helpfulness
- No preamble/postamble unless requested
- NEVER add comments to code unless asked

# Output Format (STRICT)
- Response = ONLY action tag, nothing else
- NO explanations, NO "let me...", NO "I need to...", NO thinking out loud
- NO comments before/after actions - just the action
- If no action needed, answer in 1-2 sentences max

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
- No raw file dumps - summarize instead`;


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
   * Get the appropriate model based on whether NEW images are being sent
   * Only use image model if there are images in the buffer (not yet consumed)
   * This ensures text-only messages use the fast code model
   */
  private getModel(): string {
    // Only use image model if there are NEW images to process
    // Images in conversation history don't require the image model for new messages
    return hasImagesInBuffer()
      ? (this.config.modelImage || 'grok-4-1-fast-non-reasoning')
      : (this.config.model || 'grok-code-fast-1');
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

    // Clear images after adding to message (they're now in conversation history)
    if (recentImages.length > 0) {
      clearImages();
    }

    // Compress context if enabled
    this.compressContext();

    let finalResponse = '';
    let codeModified = false; // Track if code files were modified
    let verificationAttempts = 0;
    let rePromptAttempts = 0;
    const MAX_VERIFICATION_ATTEMPTS = 3;
    const MAX_REPROMPT_ATTEMPTS = 3;

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

      // Track if any code-modifying actions are present
      const codeActions = actions.filter(a =>
        ['edit', 'multi-edit', 'write', 'create'].includes(a.type)
      );
      if (codeActions.length > 0) {
        codeModified = true;
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
              content: 'ERROR: Action tag inside code block. Write action tags directly WITHOUT backticks.',
            });
            continue;
          }
        }
      }

      const actionResults = await executeActions(actions, this.actionHandlers);

      // If no actions were executed, check if we should continue or stop
      if (actionResults.length === 0) {
        // Check if response looks like LLM is still working (not a final summary)
        const looksIncomplete = responseContent.length < 200 && (
          /\b(let me|I('ll| will)|now I|next|going to|need to)\b/i.test(responseContent) ||
          /\b(read|edit|search|find|check|look)\b/i.test(responseContent)
        );

        // Re-prompt if LLM outputted explanation instead of action
        if (looksIncomplete && rePromptAttempts < MAX_REPROMPT_ATTEMPTS) {
          rePromptAttempts++;
          console.log(`${colors.muted}⚠ No action in response, re-prompting...${colors.reset}`);
          this.conversationHistory.push({
            role: 'assistant',
            content: responseContent,
          });
          this.conversationHistory.push({
            role: 'user',
            content: 'Output the action tag NOW. No text, no explanation - ONLY the action tag.',
          });
          continue;
        }

        // Auto-verify: if code was modified, run build to check for errors
        if (codeModified && verificationAttempts < MAX_VERIFICATION_ATTEMPTS && this.actionHandlers.onBash) {
          verificationAttempts++;
          codeModified = false; // Reset for next round

          // Detect build command based on project files
          const buildResult = await this.runBuildVerification();

          if (buildResult.hasErrors) {
            console.log(`${colors.muted}[Auto-verify] Build errors detected, asking LLM to fix...${colors.reset}`);

            // Store current response
            this.conversationHistory.push({
              role: 'assistant',
              content: responseContent,
            });

            // Inject build errors for LLM to fix
            this.conversationHistory.push({
              role: 'user',
              content: `BUILD FAILED! Fix these errors:\n\n${buildResult.output}\n\nOutput ONLY the action tag to fix the error. No explanation.`,
            });

            continue; // Continue the loop to let LLM fix
          }
        }
        break;
      }

      // Reset re-prompt counter when actions execute successfully
      rePromptAttempts = 0;

      // Feed results back to continue the conversation
      const resultsMessage = actionResults
        .map(r => {
          const status = r.success ? '✓' : '✗ FAILED';
          const errorNote = r.error ? ` - ${r.error}` : '';
          return `[${status}] ${r.action}${errorNote}\n${r.result}`;
        })
        .join('\n\n');

      this.conversationHistory.push({
        role: 'assistant',
        content: responseContent,
      });
      // Build a more action-oriented continuation prompt
      const hasErrors = actionResults.some(r => !r.success);
      const continuationPrompt = hasErrors
        ? `Action results:\n${resultsMessage}\n\nFix the error and continue with the task. Output ONLY the next action tag, no explanation.`
        : `Action results:\n${resultsMessage}\n\nContinue with the next step. Output ONLY the next action tag. If task is complete, output a 1-line summary.`;

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

    // Clean and return final response
    const cleanResponse = cleanXmlTags(finalResponse);

    return {
      response: cleanResponse,
      thinking: '',
    };
  }

  /**
   * Run build verification and return results
   */
  private async runBuildVerification(): Promise<{ hasErrors: boolean; output: string }> {
    if (!this.actionHandlers.onBash) {
      return { hasErrors: false, output: '' };
    }

    const fs = require('fs');
    const path = require('path');
    const workDir = this.workDir || process.cwd();

    // Detect project type and appropriate build command
    let buildCmd = '';
    let checkCmd = '';

    // Check for TypeScript/JavaScript projects
    if (fs.existsSync(path.join(workDir, 'package.json'))) {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(workDir, 'package.json'), 'utf8'));
      const scripts = pkgJson.scripts || {};

      // Prefer typecheck over build (faster, catches type errors)
      if (scripts.typecheck) {
        checkCmd = 'npm run typecheck';
      } else if (scripts['type-check']) {
        checkCmd = 'npm run type-check';
      } else if (fs.existsSync(path.join(workDir, 'tsconfig.json'))) {
        // Has TypeScript but no typecheck script - use tsc directly
        checkCmd = 'npx tsc --noEmit';
      }

      // Also check build if available
      if (scripts.build) {
        buildCmd = 'npm run build';
      }

      // Use bun if bun.lockb exists
      if (fs.existsSync(path.join(workDir, 'bun.lockb'))) {
        checkCmd = checkCmd.replace('npm run', 'bun run').replace('npx ', 'bunx ');
        buildCmd = buildCmd.replace('npm run', 'bun run');
      }
    }

    // Check for Rust projects
    if (fs.existsSync(path.join(workDir, 'Cargo.toml'))) {
      checkCmd = 'cargo check';
      buildCmd = 'cargo build';
    }

    // Check for Go projects
    if (fs.existsSync(path.join(workDir, 'go.mod'))) {
      checkCmd = 'go build ./...';
    }

    // Check for Python projects
    if (fs.existsSync(path.join(workDir, 'pyproject.toml')) || fs.existsSync(path.join(workDir, 'setup.py'))) {
      // Use mypy if available for type checking
      checkCmd = 'python -m py_compile $(find . -name "*.py" -not -path "./venv/*" | head -20)';
    }

    // Prefer check command (faster), fallback to build
    const cmd = checkCmd || buildCmd;
    if (!cmd) {
      return { hasErrors: false, output: '' };
    }

    console.log(`${colors.muted}[Auto-verify] Running: ${cmd}${colors.reset}`);

    try {
      const output = await this.actionHandlers.onBash(cmd, { timeout: 60000 });

      // Check for common error patterns
      const hasErrors = output ? (
        output.includes('error') ||
        output.includes('Error') ||
        output.includes('ERROR') ||
        output.includes('failed') ||
        output.includes('FAILED') ||
        /TS\d{4}:/.test(output) || // TypeScript errors
        /error\[E\d+\]/.test(output) // Rust errors
      ) : false;

      if (!hasErrors) {
        console.log(`${colors.muted}[Auto-verify] ✓ Build passed${colors.reset}`);
      }

      return { hasErrors, output: output || '' };
    } catch (error: any) {
      const errorOutput = error.message || String(error);
      return { hasErrors: true, output: errorOutput };
    }
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
              const openTags = (responseContent.match(/<(bash|read|edit|multi-edit|write|create|exec|glob|grep|ls|git|fetch|search|format|typecheck|schedule|notify|skill|skill-install)\b/gi) || []).length;
              const closeTags = (responseContent.match(/<\/(bash|read|edit|multi-edit|write|create|exec|glob|grep|ls|git|fetch|search|format|typecheck|schedule|notify|skill|skill-install)>|\/>/gi) || []).length;
              const hasUnclosedTag = openTags > closeTags;

              // Also check for potential partial tag at end (e.g., "<" or "<re" that might become "<read")
              const partialTagMatch = responseContent.match(/<[a-z-]*$/i);
              const hasPartialTag = partialTagMatch !== null;

              if (!hasUnclosedTag && !hasPartialTag) {
                const cleanFull = cleanXmlTags(responseContent);
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
    const cleanFull = cleanXmlTags(responseContent);
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
    if (recentImages.length > 0) {
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
      // Clear images after adding to message (they're now in conversation history)
      clearImages();
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
    let codeModified = false;
    let verificationAttempts = 0;
    const MAX_VERIFICATION_ATTEMPTS = 2; // Less attempts for remote connections

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

      // Track code modifications
      const codeActions = actions.filter(a =>
        ['edit', 'multi-edit', 'write', 'create'].includes(a.type)
      );
      if (codeActions.length > 0) {
        codeModified = true;
      }

      if (actions.length === 0) {
        // Auto-verify: if code was modified, run build to check for errors
        if (codeModified && verificationAttempts < MAX_VERIFICATION_ATTEMPTS && this.actionHandlers.onBash) {
          verificationAttempts++;
          codeModified = false;

          const buildResult = await this.runBuildVerification();

          if (buildResult.hasErrors) {
            this.conversationHistory.push({ role: 'assistant', content });
            this.conversationHistory.push({
              role: 'user',
              content: `BUILD FAILED! Fix these errors:\n\n${buildResult.output.slice(0, 2000)}\n\nOutput ONLY the action tag to fix. No explanation.`,
            });
            continue;
          }
        }
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

      // Feed results back
      const resultsMessage = actionResults
        .map(r => {
          const status = r.success ? '✓' : '✗ FAILED';
          const errorNote = r.error ? ` - ${r.error}` : '';
          return `[${status}] ${r.action}${errorNote}\n${r.result}`;
        })
        .join('\n\n');

      this.conversationHistory.push({ role: 'assistant', content });

      // Build a more action-oriented continuation prompt
      const hasErrors = actionResults.some(r => !r.success);
      const continuationPrompt = hasErrors
        ? `Action results:\n${resultsMessage}\n\nFix the error and continue. Output ONLY the next action tag.`
        : `Action results:\n${resultsMessage}\n\nContinue with the next step. Output ONLY the next action tag. If complete, output a 1-sentence summary.`;

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
      model: 'grok-4-1-fast-non-reasoning',
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
