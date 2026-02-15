import type {
  ConfigHookEventName,
  ConfigHookMap,
  ConfigHookRule,
  HookDomain,
  HookExecutionContext,
  RuntimeConfig,
  StructuredLogger
} from './contracts.js';
import type { HookDispatcher } from './hook-dispatcher.js';
import { createShellHookHandler } from './shell-hook-executor.js';

interface InternalMapping {
  domain: HookDomain;
  event: string;
  matchField?: string;
}

const EVENT_MAP: Record<ConfigHookEventName, InternalMapping> = {
  PreToolUse:        { domain: 'lifecycle', event: 'before_tool_call', matchField: 'toolId' },
  PostToolUse:       { domain: 'lifecycle', event: 'after_tool_call', matchField: 'toolId' },
  PreCommand:        { domain: 'lifecycle', event: 'before_command', matchField: 'commandId' },
  PostCommand:       { domain: 'lifecycle', event: 'after_command', matchField: 'commandId' },
  MessageReceived:   { domain: 'lifecycle', event: 'message_received' },
  MessageSending:    { domain: 'lifecycle', event: 'message_sending' },
  MessageSent:       { domain: 'lifecycle', event: 'message_sent' },
  SessionStart:      { domain: 'lifecycle', event: 'session_start' },
  SessionEnd:        { domain: 'lifecycle', event: 'session_end' },
  Startup:           { domain: 'kernel',    event: 'startup' },
  Shutdown:          { domain: 'kernel',    event: 'shutdown' },
  Notification:      { domain: 'lifecycle', event: 'cli_init' },
  Stop:              { domain: 'lifecycle', event: 'cli_exit' },
  PreLlmCall:        { domain: 'lifecycle', event: 'before_llm_call' },
  PostLlmCall:       { domain: 'lifecycle', event: 'after_llm_call' },
  PrePromptAssemble: { domain: 'lifecycle', event: 'before_prompt_assemble' },
  PostPromptAssemble: { domain: 'lifecycle', event: 'after_prompt_assemble' }
};

function buildMatcherHandler<T extends Record<string, unknown>>(
  baseHandler: (payload: Readonly<T>, context: HookExecutionContext) => Promise<Partial<T> | void>,
  matcher: string | undefined,
  matchField: string | undefined
): (payload: Readonly<T>, context: HookExecutionContext) => Promise<Partial<T> | void> {
  if (!matcher || !matchField) {
    return baseHandler;
  }

  return async (payload, context) => {
    const fieldValue = (payload as Record<string, unknown>)[matchField];
    if (typeof fieldValue === 'string' && fieldValue !== matcher) {
      return;
    }
    return baseHandler(payload, context);
  };
}

export function registerConfigHooks(
  config: RuntimeConfig,
  dispatcher: HookDispatcher,
  cwd: string,
  logger: StructuredLogger
): void {
  const rules: ConfigHookMap | undefined = config.hooks.rules;
  if (!rules) {
    return;
  }

  let hookIndex = 0;

  for (const [eventName, ruleList] of Object.entries(rules) as Array<[ConfigHookEventName, ConfigHookRule[]]>) {
    const mapping = EVENT_MAP[eventName];
    if (!mapping) {
      logger.warn('Unknown config hook event name, skipping', { eventName });
      continue;
    }

    for (const rule of ruleList) {
      for (const entry of rule.hooks) {
        if (entry.type !== 'command') {
          logger.warn('Unsupported config hook type, skipping', { type: entry.type });
          continue;
        }

        const timeoutMs = entry.timeoutMs ?? config.hooks.defaultTimeoutMs;
        const shellHandler = createShellHookHandler({
          command: entry.command,
          event: eventName,
          matcher: rule.matcher,
          timeoutMs,
          cwd
        });

        const handler = buildMatcherHandler(shellHandler, rule.matcher, mapping.matchField);

        const hookId = `config.hook.${eventName}.${hookIndex++}`;

        dispatcher.register({
          id: hookId,
          pluginId: 'config',
          domain: mapping.domain as 'kernel',
          event: mapping.event as 'startup',
          priority: 200,
          timeoutMs,
          description: `Config hook: ${eventName}${rule.matcher ? ` [${rule.matcher}]` : ''} → ${entry.command}`,
          handler
        });

        logger.debug('Registered config hook', {
          hookId,
          event: eventName,
          matcher: rule.matcher ?? '',
          command: entry.command
        });
      }
    }
  }
}
