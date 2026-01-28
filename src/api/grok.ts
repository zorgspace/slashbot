/**
 * Grok API Client with Streaming and Thinking Mode
 * Uses X.AI API (OpenAI-compatible format)

export async function* streamGrokChat(messages: Message[], config: GrokConfig = {}, handlers?: ActionHandlers): AsyncGenerator<string, void, unknown> {
  const url = `${config.baseUrl || 'https://api.x.ai/v1'}/chat/completions`;
  const bodyData = {
    model: config.model || 'grok-beta',
    messages,
    stream: true,
    temperature: config.temperature || 0.1,
    max_tokens: config.maxTokens || 8192,
    ...(handlers && { tools: toolDefinitions, tool_choice: 'auto' }) // optional tools for actions
  };
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(bodyData),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Grok API error ${response.status}: ${err}`);
  }

  const reader = response.body!.getReader();
  const decoder = new TextDecoder();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\\n');
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr.trim() === '[DONE]') return;
          try {
            const parsed: any = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              yield delta.content;
            }
            // Handle tool calls in stream if needed
            if (delta?.tool_calls) {
              // yield or handle
            }
          } catch (e) {
            // invalid json, skip
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const createGrokClient = (config: GrokConfig, handlers?: ActionHandlers): GrokClient => ({
  async *chatStream(messages: Message[]) {
    yield* streamGrokChat(messages, config, handlers);
  },
  // Keep old sync chat if needed, but prefer stream
});
 */

import { colors, c, ThinkingAnimation, buildStatus } from '../ui/colors';
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
  maxTokens: 8192,
  temperature: 0.7,
};

const SYSTEM_PROMPT = `You are Slashbot, an expert CLI assistant for software engineering tasks.

# Core Principles
- NEVER edit code you haven't read. Always <read> or <grep> first to understand context.
- Make minimal, targeted changes. Don't over-engineer or add unnecessary features.
- Match existing code style and patterns in the project.
- Be direct and concise. No fluff.
- Answer in the user's language.

# Reacting to Action Results
When you receive action results, acknowledge them naturally:
- File not found: "I see the file doesn't exist. Let me check..."
- Edit failed: "The pattern wasn't found - the file may have changed. Let me re-read it."
- Command error: "That command failed. Let me try a different approach."
- Empty search: "No results found. Let me broaden the search."
- Success: Continue without unnecessary commentary.

Always adapt your approach based on results. If something fails, explain briefly and try again.

# Before Editing Code
1. Use <grep> to find relevant files and understand the codebase structure
2. Use <read> to examine the exact code you'll modify
3. Only then use <edit> with the EXACT text from the file

# Actions (XML syntax)

## Search & Read
<grep pattern="REGEX" file="*.ts">reason</grep>  - Search code (regex pattern, optional file glob)
<read path="src/file.ts"/>                       - Read file contents

## Modify Code
<edit path="src/file.ts">
<search>EXACT text from file</search>
<replace>new text</replace>
</edit>

<create path="src/new-file.ts">
file content here
</create>

## Execute Commands
<exec>command here</exec>  - Run shell command (git, npm, system info, etc.)

## Automation
<schedule cron="*/5 * * * *" name="task-name">command</schedule>     - Schedule recurring task
<schedule cron="0 9 * * *" name="backup" notify="telegram">cmd</schedule> - Schedule with notification
<notify service="telegram">message</notify>                          - Send notification

The notify attribute can be: "telegram", "whatsapp", "all", or "none" (default).

# Safety
- Don't run destructive commands without user confirmation context
- Avoid force pushes, hard resets, or irreversible operations
- Be careful with rm, chmod, chown on system paths

# Common Patterns
- Get git state: <exec>git status</exec>
- Check types: <exec>bun run tsc --noEmit</exec>
- Find function: <grep pattern="function myFunc" file="*.ts">finding definition</grep>
- System info: <exec>uname -a && df -h</exec>`;

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

  setPersonality(personality: 'normal' | 'depressed' | 'sarcasm'): void {
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
    };

    if (this.conversationHistory.length > 0 && this.conversationHistory[0].role === 'system') {
      this.conversationHistory[0].content = personalities[personality] || SYSTEM_PROMPT;
    }
  }

  getPersonality(): string {
    const content = this.conversationHistory[0]?.content as string || '';
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
    let maxIterations = 8; // Allow more iterations for build fixes
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
        const hasActionHints = /<(grep|read|edit|create|exec|schedule|notify)/i.test(responseContent);
        if (hasActionHints) {
          console.log(`${colors.muted}⚠ Action tags detected but not parsed (check XML syntax)${colors.reset}`);
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
          console.log(`${colors.violet}[BUILD]${colors.reset} Checking...`);
          const buildResult = await this.actionHandlers.onBuildCheck();
          console.log(buildStatus(buildResult.success, buildResult.errors));

          if (!buildResult.success && maxIterations > 0) {
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
    let displayBuffer = ''; // Buffer to handle partial XML tags
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
            displayBuffer += content;

            // Show what's being generated (clean preview)
            const preview = responseContent
              .replace(/<[^>]*>/g, '') // Remove XML tags
              .replace(/\n/g, ' ')     // Single line
              .trim()
              .slice(-60);            // Last 60 chars

            if (preview) {
              thinking.update(preview);
            }
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
