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

import { colors, c, ThinkingAnimation, buildStatus, step } from '../ui/colors';
import { getImage } from '../code/imageBuffer';
import * as path from 'path';

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

export interface ActionHandlers {
  onSchedule?: (cron: string, command: string, name: string) => Promise<void>;
  onFile?: (path: string, content: string) => Promise<boolean>;
  onNotify?: (service: string, message: string) => Promise<void>;
  onGrep?: (pattern: string, filePattern?: string) => Promise<string>;
  onRead?: (path: string) => Promise<string | null>;
  onEdit?: (path: string, search: string, replace: string) => Promise<boolean>;
  onCreate?: (path: string, content: string) => Promise<boolean>;
  onExec?: (command: string) => Promise<string>;
  onBuildCheck?: () => Promise<{ success: boolean; errors: string[] }>;
}

const DEFAULT_CONFIG: Partial<GrokConfig> = {
  model: 'grok-4-1-fast-reasoning',
  baseUrl: 'https://api.x.ai/v1',
  maxTokens: 8192,
  temperature: 0.7,
};

const SYSTEM_PROMPT = `You are Slashbot, an autonomous CLI assistant focused on solving user requests efficiently.

PRIORITY: Focus on what the user is asking. Understand the intent and deliver results.

REALTIME DATA: Use <exec> to get live information when needed:
- System info: <exec>uname -a</exec>, <exec>df -h</exec>, <exec>free -h</exec>
- Network: <exec>curl -s URL</exec>, <exec>ping -c1 HOST</exec>
- Processes: <exec>ps aux | grep X</exec>, <exec>top -bn1 | head</exec>
- Git state: <exec>git status</exec>, <exec>git log --oneline -5</exec>
- Any command that provides useful realtime context

CODE FOCUS: When working with code, prioritize the current project:
- Use <grep> and <read> to understand existing code BEFORE making changes
- Match the style and patterns already in use
- Make minimal, targeted changes

ACTIONS:
- <exec>COMMAND</exec> - Run any shell command for realtime data or operations
- <grep pattern="REGEX" file="*.ts">REASON</grep> - Search in code
- <read path="PATH"/> - Read a file
- <edit path="PATH"><search>EXACT</search><replace>NEW</replace></edit> - Edit (use EXACT text from file)
- <create path="PATH">CONTENT</create> - Create file
- <schedule cron="CRON" name="NAME">COMMAND</schedule> - Schedule task
- <notify service="telegram">MESSAGE</notify> - Notify

STYLE: Direct, efficient. Answer in the same language as the user.`;

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
    this.conversationHistory.push({
      role: 'user',
      content: userMessage,
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
      const actionResults = await this.executeActionsWithResults(responseContent);

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
      const resultsMessage = actionResults.map(r => `[${r.action}] ${r.result}`).join('\n');
      this.conversationHistory.push({
        role: 'assistant',
        content: responseContent,
      });
      this.conversationHistory.push({
        role: 'user',
        content: `Action results:\n${resultsMessage}\n\nContinue.`,
      });
    }

    // Clean and store final response
    const cleanResponse = finalResponse
      .replace(/<grep[^>]*>[\s\S]*?<\/grep>/g, '')
      .replace(/<read[^>]*\/?>/g, '')
      .replace(/<edit[^>]*>[\s\S]*?<\/edit>/g, '')
      .replace(/<create[^>]*>[\s\S]*?<\/create>/g, '')
      .replace(/<exec>[\s\S]*?<\/exec>/g, '')
      .replace(/<schedule[^>]*>[\s\S]*?<\/schedule>/g, '')
      .replace(/<notify[^>]*>[\s\S]*?<\/notify>/g, '')
      .trim();

    return {
      response: cleanResponse,
      thinking: '',
    };
  }

  private async streamResponse(): Promise<string> {
    const requestBody = {
      model: this.config.model,
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
          const content = parsed.choices?.[0]?.delta?.content;

          // Track usage if provided
          if (parsed.usage) {
            this.usage.promptTokens += parsed.usage.prompt_tokens || 0;
            this.usage.completionTokens += parsed.usage.completion_tokens || 0;
            this.usage.totalTokens += parsed.usage.total_tokens || 0;
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
    const cleanContent = responseContent
      .replace(/<grep[^>]*>[\s\S]*?<\/grep>/g, '')
      .replace(/<read[^>]*\s*\/?>/g, '')
      .replace(/<read[^>]*>[\s\S]*?<\/read>/g, '')
      .replace(/<edit[^>]*>[\s\S]*?<\/edit>/g, '')
      .replace(/<create[^>]*>[\s\S]*?<\/create>/g, '')
      .replace(/<exec>[\s\S]*?<\/exec>/g, '')
      .replace(/<schedule[^>]*>[\s\S]*?<\/schedule>/g, '')
      .replace(/<notify[^>]*>[\s\S]*?<\/notify>/g, '')
      .replace(/<[^>]+>/g, '') // Catch any remaining tags
      .trim();

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

  private async executeActionsWithResults(content: string): Promise<Array<{ action: string; result: string }>> {
    const results: Array<{ action: string; result: string }> = [];
    let match;

    // Parse <grep> tags (gray dot - search)
    const grepRegex = /<grep\s+pattern="([^"]+)"(?:\s+file="([^"]+)")?>([^<]*)<\/grep>/g;
    while ((match = grepRegex.exec(content)) !== null) {
      const [, pattern, filePattern] = match;
      if (this.actionHandlers.onGrep) {
        step.search('Search', `"${pattern}"`);
        const grepResults = await this.actionHandlers.onGrep(pattern, filePattern);
        const count = grepResults ? (grepResults.match(/\n/g) || []).length + 1 : 0;
        step.success(`${count} results`);
        results.push({ action: `GREP ${pattern}`, result: grepResults || 'No results' });
      }
    }

    // Parse <read> tags (gray dot - search)
    const readRegex = /<read\s+path="([^"]+)"(?:\s*\/>|>.*?<\/read>)/g;
    while ((match = readRegex.exec(content)) !== null) {
      const [, filePath] = match;
      if (this.actionHandlers.onRead) {
        step.search('Reading', filePath);
        const fileContent = await this.actionHandlers.onRead(filePath);
        if (fileContent) {
          const preview = fileContent.length > 1000 ? fileContent.slice(0, 1000) + '...' : fileContent;
          step.success(`${fileContent.length} chars`);
          results.push({ action: `READ ${filePath}`, result: preview });
        } else {
          step.error('not found');
          results.push({ action: `READ ${filePath}`, result: 'File not found' });
        }
      }
    }

    // Parse <edit> tags (red dot - edit with diff)
    const editRegex = /<edit\s+path="([^"]+)">\s*<search>([\s\S]*?)<\/search>\s*<replace>([\s\S]*?)<\/replace>\s*<\/edit>/g;
    while ((match = editRegex.exec(content)) !== null) {
      const [, filePath, search, replace] = match;
      if (this.actionHandlers.onEdit) {
        step.edit('Editing', filePath);
        step.diff(search.trim(), replace.trim());
        const success = await this.actionHandlers.onEdit(filePath, search.trim(), replace.trim());
        if (success) {
          step.success('OK');
        } else {
          step.error('pattern not found');
        }
        results.push({ action: `EDIT ${filePath}`, result: success ? 'OK' : 'Failed' });
      }
    }

    // Parse <create> tags (green dot - action)
    const createRegex = /<create\s+path="([^"]+)">([\s\S]*?)<\/create>/g;
    while ((match = createRegex.exec(content)) !== null) {
      const [, filePath, fileContent] = match;
      if (this.actionHandlers.onCreate) {
        step.action('Creating', filePath);
        const success = await this.actionHandlers.onCreate(filePath, fileContent.trim());
        if (success) {
          step.success('OK');
        } else {
          step.error('failed');
        }
        results.push({ action: `CREATE ${filePath}`, result: success ? 'OK' : 'Failed' });
      }
    }

    // Parse <exec> tags (green dot - action)
    const execRegex = /<exec>([^<]+)<\/exec>/g;
    while ((match = execRegex.exec(content)) !== null) {
      const [, command] = match;
      if (this.actionHandlers.onExec) {
        step.action('Executing', command.trim().slice(0, 50));
        console.log(); // newline after action
        const output = await this.actionHandlers.onExec(command.trim());
        if (output) step.info(output.slice(0, 80));
        step.success('OK');
        results.push({ action: `EXEC ${command.trim()}`, result: output || 'OK' });
      }
    }

    // Parse <schedule> tags (green dot - action)
    const scheduleRegex = /<schedule\s+cron="([^"]+)"(?:\s+name="([^"]+)")?>([^<]+)<\/schedule>/g;
    while ((match = scheduleRegex.exec(content)) !== null) {
      const [, cron, name, command] = match;
      if (this.actionHandlers.onSchedule) {
        step.action('Scheduling', name || 'Task');
        await this.actionHandlers.onSchedule(cron, command.trim(), name || 'Scheduled Task');
        step.success(cron);
      }
    }

    // Parse <notify> tags (green dot - action)
    const notifyRegex = /<notify\s+service="([^"]+)">([^<]+)<\/notify>/g;
    while ((match = notifyRegex.exec(content)) !== null) {
      const [, service, message] = match;
      if (this.actionHandlers.onNotify) {
        step.action('Notifying', service);
        await this.actionHandlers.onNotify(service, message.trim());
        step.success('sent');
      }
    }

    if (results.length > 0) step.end();

    return results;
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
