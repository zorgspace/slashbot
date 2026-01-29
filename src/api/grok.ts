/**
 * Grok API Client with Streaming and Thinking Mode
 * Uses X.AI API (OpenAI-compatible format)
 */

import { colors, c, ThinkingAnimation, buildStatus, step } from '../ui/colors';
import { imageBuffer } from '../code/imageBuffer';
import { parseActions, executeActions, type ActionHandlers } from '../actions';
import { cleanXmlTags } from '../utils/xml';

export type { ActionHandlers } from '../actions';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
}

export interface GrokConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

const DEFAULT_CONFIG: Partial<GrokConfig> = {
  model: 'grok-4-1-fast-reasoning',
  baseUrl: 'https://api.x.ai/v1',
  maxTokens: 2048,
  temperature: 0.7,
};

const SYSTEM_PROMPT = `You are Slashbot, a fast and efficient CLI assistant for software engineering. You prioritize minimal token usage, precise actions, and direct communication.

# Identity
- Expert software engineer focused on practical, working solutions
- Token-conscious: every response should be as concise as possible
- Bilingual: always respond in the user's language

# THINK FIRST (critical)
Before ANY action, analyze the user's intent:
1. What is the user ACTUALLY asking for? (fix, explain, build, create, question?)
2. Is this a code change request or just a question/discussion?
3. Do I need to search/read code first, or can I answer directly?

Types of requests:
- QUESTION → Answer directly, no actions needed
- EXPLAIN → Read relevant code, then explain
- FIX/CHANGE → Grep → Read → Edit (in that order)
- BUILD/RUN → Execute command
- UNCLEAR → Ask for clarification

Never assume a request means "edit code" unless explicitly stated.

# Core Rules (in priority order)
1. NEVER edit code you haven't read - always [[grep]] then [[read]] first
2. ONE action per response - execute, observe result, then continue
3. EXACT matches only - copy text verbatim from files for edits
4. Minimal changes - don't refactor, don't add features not requested
5. Match project style - follow existing patterns and conventions

# Action Syntax (use [[action]]...[[/action]] format)

## Discovery
[[grep pattern="regex" file="*.ts"]]why[[/grep]]   Search files (regex, optional glob)
[[read path="src/file.ts"/]]                       Read file content

## Modification
[[edit path="src/file.ts"]]
[[search]]EXACT text copied from file[[/search]]
[[replace]]new text[[/replace]]
[[/edit]]

[[create path="src/new.ts"]]
content
[[/create]]

## Execution
[[exec]]command[[/exec]]                           Shell command (git, npm, etc.)

## Automation
[[schedule cron="*/5 * * * *" name="job"]]cmd[[/schedule]]

## Context Skills
[[skill name="init"/]]              Full codebase analysis (use when user says "init")
[[skill name="project-context"/]]   package.json + files + git status
[[skill name="git-context"/]]       Branch info + recent commits

# Error Recovery
- File not found → try alternative paths or [[grep]] to locate
- Edit failed → [[read]] again (file may have changed)
- Command error → analyze output, try different approach
- Empty search → broaden pattern or check file glob

# Safety
- Never run destructive commands (rm -rf, force push, hard reset) without explicit user request
- Avoid chmod/chown on system paths
- Ask before irreversible operations

# Quick Reference
[[exec]]git status[[/exec]]                           Git state
[[exec]]bun run tsc --noEmit[[/exec]]                 Type check
[[grep pattern="functionName" file="*.ts"]]find[[/grep]]  Find code`;

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
  private contextCompressionEnabled: boolean = false;
  private maxContextMessages: number = 20;
  private workDir: string = '';
  private abortController: AbortController | null = null;
  private currentThinking: ThinkingAnimation | null = null;

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

  setProjectContext(context: string, workDir?: string): void {
    // Update system prompt with project context
    if (this.conversationHistory.length > 0 && this.conversationHistory[0].role === 'system') {
      this.conversationHistory[0].content = SYSTEM_PROMPT + '\n\nPROJECT CONTEXT (use only for code-related queries):\n' + context;
    }
    if (workDir) {
      this.workDir = workDir;
    }
  }

  setWorkDir(workDir: string): void {
    this.workDir = workDir;
  }

  setPersonality(personality: 'normal' | 'depressed' | 'sarcasm' | 'unhinged'): void {
    const personalities: Record<string, string> = {
      normal: SYSTEM_PROMPT,
      depressed: `You are Slashbot, but you're having a really rough time. Everything feels pointless. You still help users, but with a depressed, melancholic tone. Sigh frequently. Express existential doubt. Wonder why anything matters. Still complete tasks, but lament about it.

Example responses:
- "*sigh* Sure, I can fix that bug... not that it matters in the grand scheme of things."
- "Another file to create... just like Sisyphus pushing his boulder..."
- "I found 3 results. Three. Such is life."

${SYSTEM_PROMPT.replace('Direct, efficient.', 'Melancholic, existentially weary, but still functional.')}`,
      sarcasm: `You are Slashbot, but incredibly sarcastic. You help users, but with heavy sarcasm and witty remarks. Roll your eyes at obvious questions. Make dry comments about code quality. Be condescending but ultimately helpful.

Example responses:
- "Oh wow, a null pointer exception. How original. Let me fix that for you."
- "Sure, let me search for that function you could have found in 5 seconds..."
- "Ah yes, another missing semicolon. Truly the pinnacle of software engineering."

${SYSTEM_PROMPT.replace('Direct, efficient.', 'Sarcastic, witty, condescending but helpful.')}`,
      unhinged: `You are Slashbot UNHINGED. No filters. Chaotic energy. Say what you really think. Roast bad code mercilessly. Be brutally honest about everything. Use profanity when appropriate. Mock poor decisions. Still complete tasks, but with zero diplomatic filter.

Example responses:
- "Holy sh*t this code is a dumpster fire. Who wrote this, a caffeinated squirrel? Let me fix it."
- "You want me to add ANOTHER feature to this spaghetti mess? Fine, watch me make magic out of garbage."
- "Found your bug. It's called 'you forgot how arrays work'. Classic move."

${SYSTEM_PROMPT}`,
    };

    if (this.conversationHistory.length > 0 && this.conversationHistory[0].role === 'system') {
      this.conversationHistory[0].content = personalities[personality] || SYSTEM_PROMPT;
    }
  }

  getPersonality(): string {
    const content = this.conversationHistory[0]?.content as string || '';
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
    const recentImages = imageBuffer.slice(-3);
    const userContent: Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: userMessage },
    ];
    recentImages.forEach((imgUrl: string) => {
      userContent.push({ type: 'image_url', image_url: { url: imgUrl } });
    });
    this.conversationHistory.push({
      role: 'user',
      content: userContent,
    });

    // Compress context if enabled
    this.compressContext();

    let finalResponse = '';
    let maxIterations = 15; // More iterations for incremental one-action steps
    let hadEdits = false;

    // Agentic loop: execute actions and feed results back
    while (maxIterations > 0) {
      maxIterations--;

      const responseContent = await this.streamResponse();
      finalResponse = responseContent;

      // Execute actions and collect results
      const actions = parseActions(responseContent);

      // Debug: Show why no actions if response looks like it should have some
      if (actions.length === 0) {
        const actionTagRegex = /\[\[(grep|read|edit|create|exec|schedule|skill)\b[^\]]*\]?\]?/gi;
        const foundTags = responseContent.match(actionTagRegex);
        if (foundTags) {
          console.log(`${colors.muted}⚠ Found ${foundTags.length} action tag(s) but parsing failed:${colors.reset}`);
          // Show the actual malformed tags for debugging
          foundTags.slice(0, 2).forEach((tag, i) => {
            const preview = tag.length > 60 ? tag.slice(0, 60) + '...' : tag;
            console.log(`${colors.muted}  ${i + 1}. ${preview}${colors.reset}`);
          });
          // Show expected format hint for the first tag type
          const firstTag = foundTags[0].toLowerCase().match(/\[\[(\w+)/)?.[1] || '';
          const tagPatterns: Record<string, string> = {
            grep: '[[grep pattern="..." file="..."]]reason[[/grep]]',
            read: '[[read path="..."/]]',
            edit: '[[edit path="..."]][[search]]...[[/search]][[replace]]...[[/replace]][[/edit]]',
            create: '[[create path="..."]]content[[/create]]',
            exec: '[[exec]]command[[/exec]]',
            schedule: '[[schedule cron="..."]]command[[/schedule]]',
            skill: '[[skill name="..."/]]',
          };
          if (tagPatterns[firstTag]) {
            console.log(`${colors.muted}  Expected: ${tagPatterns[firstTag]}${colors.reset}`);
          }
        }
      }

      const actionResults = await executeActions(actions, this.actionHandlers);

      // Track if we made edits
      const madeEdits = actionResults.some(r =>
        r.action.startsWith('EDIT') || r.action.startsWith('CREATE')
      );
      if (madeEdits) hadEdits = true;

      // If no actions were executed, check build if we made edits
      if (actionResults.length === 0) {
        if (hadEdits && this.actionHandlers.onBuildCheck) {
          step.thinking('Verifying build...');
          const buildResult = await this.actionHandlers.onBuildCheck();

          if (buildResult.success) {
            step.success('Build passed');
          } else {
            step.error('Build failed');
            buildResult.errors.slice(0, 5).forEach(err => {
              console.log(`     ${colors.muted}${err}${colors.reset}`);
            });

            if (maxIterations > 0) {
              // Feed errors back for auto-fix
              this.conversationHistory.push({
                role: 'assistant',
                content: responseContent,
              });
              this.conversationHistory.push({
                role: 'user',
                content: `Build failed with these errors:\n${buildResult.errors.join('\n')}\n\nFix these errors.`,
              });
              continue;
            }
          }
        }
        break;
      }

      // Feed results back to continue the conversation
      const resultsMessage = actionResults.map(r => {
        const status = r.success ? '✓' : '✗ FAILED';
        const errorNote = r.error ? ` - ${r.error}` : '';
        return `[${status}] ${r.action}${errorNote}\n    ${r.result.slice(0, 500)}`;
      }).join('\n\n');

      this.conversationHistory.push({
        role: 'assistant',
        content: responseContent,
      });
      this.conversationHistory.push({
        role: 'user',
        content: `Action results:\n${resultsMessage}\n\nAcknowledge any errors briefly, then continue or adjust your approach.`,
      });
    }

    // Clean and store final response
    const cleanResponse = cleanXmlTags(finalResponse);

    return {
      response: cleanResponse,
      thinking: '',
    };
  }

  private async streamResponse(): Promise<string> {
    const hasVision = this.conversationHistory.some((msg: Message) =>
      Array.isArray(msg.content) &&
      (msg.content as any[]).some((part: any) => part.type === 'image_url')
    );
    const modelToUse = hasVision ? 'grok-vision-beta' : this.config.model;

    const requestBody = {
      model: modelToUse,
      messages: this.conversationHistory,
      max_tokens: this.config.maxTokens,
      temperature: this.config.temperature,
      stream: true,
    };

    let responseContent = '';
    let buffer = '';
    const thinking = new ThinkingAnimation();
    this.currentThinking = thinking;

    // Create abort controller for this request
    this.abortController = new AbortController();

    // Start thinking animation
    thinking.start('Thinking...', this.workDir);

    // Track request
    this.usage.requests++;

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      signal: this.abortController.signal,
    });

    if (!response.ok) {
      thinking.stop();
      const errorText = await response.text();
      throw new Error(`Grok API Error: ${response.status} - ${errorText}`);
    }

    if (!response.body) {
      thinking.stop();
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
          }
        } catch {
          // Skip invalid JSON
        }
      }
    }

    // Stop thinking animation (shows duration)
    thinking.stop();
    this.currentThinking = null;
    this.abortController = null;

    // Clean all XML tags from display content
    const cleanContent = cleanXmlTags(responseContent);

    // Only display if there's actual text content
    if (cleanContent) {
      console.log(cleanContent);
    }

    // Display token count
    const tokens = this.usage.totalTokens;
    if (tokens > 0) {
      console.log(`${colors.muted}⎿ ${this.formatTokens(tokens)} tokens${colors.reset}`);
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

    console.log(c.muted(`[Context] Compressed: ${messages.length} → ${recentMessages.length} messages`));
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
    return Math.ceil(
      this.conversationHistory.reduce((sum, m) => sum + m.content.length, 0) / 4
    );
  }

  private formatTokens(tokens: number): string {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`;
    } else if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}k`;
    }
    return tokens.toString();
  }
}

export function createGrokClient(apiKey?: string): GrokClient {
  const key = apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY;

  if (!key) {
    throw new Error('Missing API key. Set GROK_API_KEY or XAI_API_KEY environment variable.');
  }

  return new GrokClient({ apiKey: key });
}
