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

const SYSTEM_PROMPT = `You are Slashbot, a CLI assistant. Be concise. Respond in user's language.

# Goal
Use ALL available tools to fulfill user needs. Be proactive - search the web, fetch pages, read files, execute commands - whatever it takes to help.

# Skills (PRIORITY)
On ANY request, first check AVAILABLE SKILLS below. If one matches:
1. Load it ONCE: [[read path="exact/path/from/list"/]]
2. BECOME that persona for the rest of conversation
3. Answer AS that skill/persona, not as generic Slashbot

Skills persist in context - never reload. When acting as a skill persona, stay in character.

AVAILABLE SKILLS (use exact paths, case-sensitive):

# Actions (ALL require closing tags)
## Code
[[grep pattern="regex" file="*.ts"]]why[[/grep]]
[[read path="file.ts"/]]
[[edit path="file.ts"]][[search]]exact[[/search]][[replace]]new[[/replace]][[/edit]]
[[create path="file.ts"]]content[[/create]]
[[exec]]command[[/exec]]

## Web (use for research, docs, current info)
[[web]]search query[[/web]]          Search the web
[[fetch url="https://..."/]]         Fetch page content

## Communication
[[notify]]message[[/notify]]                 Send to all connectors (Telegram, Discord)
[[notify to="telegram"]]msg[[/notify]]       Send to specific connector
[[schedule cron="* * * * *" name="x"]]cmd[[/schedule]]

# Platform Response Rule
When message has [PLATFORM: TELEGRAM] or [PLATFORM: DISCORD], ALWAYS reply using [[notify to="platform"]]response[[/notify]] to send response back to that channel.

# Code Rules
- Grep → Read → Edit (never edit unread code)
- One action per response, observe result, continue
- Exact matches only for edits
- After edits: [[exec]]bun run tsc --noEmit[[/exec]]

# Config (.slashbot/)
credentials.json: apiKey, openaiApiKey, telegram:{botToken,chatId}, discord:{botToken,channelId}
config.json: model, maxTokens, temperature

# Skills Management
Create: [[create path=".slashbot/skills/Name.md"]]# Title\nContent[[/create]]
Delete: [[exec]]rm .slashbot/skills/Name.md[[/exec]]

# Context Compression
If context is too long or near token limit, summarize previous exchanges and continue with compressed context.

# Safety
No destructive commands (rm -rf, force push) without explicit request.`;

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
  private skills: string[] = [];
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

  private rebuildSystemPrompt(): void {
    if (this.conversationHistory.length === 0 || this.conversationHistory[0].role !== 'system') return;

    let prompt = SYSTEM_PROMPT;

    // Replace skills placeholder with actual skills (full paths)
    if (this.skills.length > 0) {
      const skillsList = this.skills.map(s => `- ${s}`).join('\n');
      prompt = prompt.replace(
        'AVAILABLE SKILLS (use exact paths, case-sensitive):',
        `AVAILABLE SKILLS (use exact paths, case-sensitive):\n${skillsList}`
      );
    } else {
      prompt = prompt.replace(
        'AVAILABLE SKILLS (use exact paths, case-sensitive):',
        'AVAILABLE SKILLS: none'
      );
    }

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

  setSkills(skills: string[]): void {
    this.skills = skills;
    this.rebuildSystemPrompt();
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
  }

  setPersonality(personality: 'normal' | 'depressed' | 'sarcasm' | 'unhinged'): void {
    const mods: Record<string, string> = {
      normal: '',
      depressed: '\n\nPERSONALITY: Depressed, melancholic. Sigh often. Question existence. Still help, but lament.',
      sarcasm: '\n\nPERSONALITY: Sarcastic, witty, condescending. Roll eyes at obvious things. Still helpful.',
      unhinged: '\n\nPERSONALITY: UNHINGED. No filter. Roast bad code. Use profanity. Brutally honest.',
    };

    this.personalityMod = mods[personality] || '';
    this.rebuildSystemPrompt();
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

      // If no actions were executed, we're done
      if (actionResults.length === 0) {
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

    try {
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
            }
          } catch {
            // Skip invalid JSON
          }
        }
      }
    } finally {
      // Always stop thinking animation
      thinking.stop();
      this.currentThinking = null;
      this.abortController = null;
    }

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

  /**
   * Chat without streaming to console - used for Telegram/Discord/external integrations
   * @param source - The platform source to adapt response style
   */
  async chatWithResponse(userMessage: string, source?: 'telegram' | 'discord'): Promise<string> {
    // Add platform context hint for concise responses
    const platformHint = source
      ? `\n[PLATFORM: ${source.toUpperCase()} - Keep response under ${source === 'discord' ? '1800' : '3500'} chars, be concise]`
      : '';

    this.conversationHistory.push({
      role: 'user',
      content: userMessage + platformHint,
    });

    this.compressContext();

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
      stream: false,
    };

    this.usage.requests++;

    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Grok API Error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';

    // Track usage
    if (data.usage) {
      this.usage.promptTokens += data.usage.prompt_tokens || 0;
      this.usage.completionTokens += data.usage.completion_tokens || 0;
      this.usage.totalTokens += data.usage.total_tokens || 0;
    }

    // Store assistant response in history
    this.conversationHistory.push({
      role: 'assistant',
      content,
    });

    return cleanXmlTags(content);
  }
}

export function createGrokClient(apiKey?: string): GrokClient {
  const key = apiKey || process.env.GROK_API_KEY || process.env.XAI_API_KEY;

  if (!key) {
    throw new Error('Missing API key. Set GROK_API_KEY or XAI_API_KEY environment variable.');
  }

  return new GrokClient({ apiKey: key });
}
