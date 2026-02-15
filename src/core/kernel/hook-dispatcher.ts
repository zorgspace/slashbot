import type {
  HookDispatchReport,
  HookDomain,
  HookExecutionContext,
  HookFailure,
  HookRegistration,
  JsonValue,
  KernelHookName,
  LifecycleHookName,
  RuntimeConfig,
  StructuredLogger
} from './contracts.js';

type InternalHook = HookRegistration<Record<string, unknown>> & {
  registrationOrder: number;
};

type HookEventPublisher = (eventType: string, payload: Record<string, JsonValue>) => void;

const EVENT_MAX_DEPTH = 4;
const EVENT_MAX_ITEMS = 40;
const EVENT_MAX_STRING_CHARS = 600;

function clonePayload<T extends Record<string, unknown>>(payload: T): T {
  return { ...payload };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  return new Promise<T>((resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`Hook timed out after ${timeoutMs}ms`)), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch((err) => reject(err))
      .finally(() => {
        if (timeout) {
          clearTimeout(timeout);
        }
      });
  });
}

function compareHooks(a: InternalHook, b: InternalHook): number {
  const aPriority = a.priority ?? 100;
  const bPriority = b.priority ?? 100;
  if (aPriority !== bPriority) {
    return aPriority - bPriority;
  }
  return a.registrationOrder - b.registrationOrder;
}

function truncate(value: string, maxChars = EVENT_MAX_STRING_CHARS): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...[truncated]`;
}

function toEventJson(value: unknown, depth = 0): JsonValue {
  if (value === null) return null;
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: truncate(value.message),
    };
  }

  if (depth >= EVENT_MAX_DEPTH) {
    return '[depth_truncated]';
  }

  if (Array.isArray(value)) {
    const head = value.slice(0, EVENT_MAX_ITEMS).map((entry) => toEventJson(entry, depth + 1));
    if (value.length > EVENT_MAX_ITEMS) {
      head.push(`[+${value.length - EVENT_MAX_ITEMS} more]`);
    }
    return head;
  }

  if (typeof value === 'object') {
    const output: Record<string, JsonValue> = {};
    const entries = Object.entries(value as Record<string, unknown>);
    for (const [key, entryValue] of entries.slice(0, EVENT_MAX_ITEMS)) {
      output[key] = toEventJson(entryValue, depth + 1);
    }
    if (entries.length > EVENT_MAX_ITEMS) {
      output.__truncated__ = `+${entries.length - EVENT_MAX_ITEMS} keys`;
    }
    return output;
  }

  return truncate(String(value));
}

function contextToEvent(context: HookExecutionContext): Record<string, JsonValue> {
  return {
    sessionId: context.sessionId ?? null,
    agentId: context.agentId ?? null,
    requestId: context.requestId ?? null,
    aborted: context.abortSignal?.aborted ?? false,
  };
}

export class HookDispatcher {
  private readonly hooks: InternalHook[] = [];
  private registrationCounter = 0;

  constructor(
    private readonly config: Pick<RuntimeConfig, 'hooks'>,
    private readonly logger: StructuredLogger,
    private readonly publishEvent?: HookEventPublisher,
  ) {}

  private emit(eventType: string, payload: Record<string, JsonValue>): void {
    try {
      this.publishEvent?.(eventType, payload);
    } catch {
      // hook observability must never affect execution
    }
  }

  register(hook: HookRegistration<Record<string, unknown>>): void {
    this.hooks.push({
      ...hook,
      registrationOrder: this.registrationCounter++
    });

    this.emit('hook:registered', {
      hookId: hook.id,
      pluginId: hook.pluginId,
      domain: hook.domain,
      event: hook.event,
      priority: hook.priority ?? 100,
      timeoutMs: hook.timeoutMs ?? this.config.hooks.defaultTimeoutMs,
      at: new Date().toISOString(),
    });
  }

  async dispatchKernel<T extends Record<string, unknown>>(
    event: KernelHookName,
    payload: T,
    context: HookExecutionContext
  ): Promise<HookDispatchReport<T>> {
    return this.dispatch('kernel', event, payload, context);
  }

  async dispatchLifecycle<T extends Record<string, unknown>>(
    event: LifecycleHookName,
    payload: T,
    context: HookExecutionContext
  ): Promise<HookDispatchReport<T>> {
    return this.dispatch('lifecycle', event, payload, context);
  }

  async dispatchCustom<T extends Record<string, unknown>>(
    event: string,
    payload: T,
    context: HookExecutionContext
  ): Promise<HookDispatchReport<T>> {
    return this.dispatch('custom', event, payload, context);
  }

  async dispatchAny<T extends Record<string, unknown>>(
    domain: HookDomain,
    event: string,
    payload: T,
    context: HookExecutionContext
  ): Promise<HookDispatchReport<T>> {
    return this.dispatch(domain, event, payload, context);
  }

  private async dispatch<T extends Record<string, unknown>>(
    domain: HookDomain,
    event: string,
    payload: T,
    context: HookExecutionContext
  ): Promise<HookDispatchReport<T>> {
    const dispatchStartedAt = Date.now();
    const applicableHooks = this.hooks
      .filter((hook) => hook.domain === domain && hook.event === event)
      .sort(compareHooks);

    const failures: HookFailure[] = [];
    const workingPayload = clonePayload(payload);

    this.emit('hook:dispatch_start', {
      domain,
      event,
      hooksCount: applicableHooks.length,
      context: toEventJson(contextToEvent(context)),
      payload: toEventJson(payload),
      at: new Date().toISOString(),
    });

    for (const hook of applicableHooks) {
      const start = Date.now();
      const timeoutMs = hook.timeoutMs ?? this.config.hooks.defaultTimeoutMs;
      this.emit('hook:invoke_start', {
        domain,
        event,
        hookId: hook.id,
        pluginId: hook.pluginId,
        priority: hook.priority ?? 100,
        timeoutMs,
        context: toEventJson(contextToEvent(context)),
        at: new Date().toISOString(),
      });

      try {
        const result = await withTimeout(
          Promise.resolve(hook.handler(workingPayload, context)),
          timeoutMs
        );
        const elapsedMs = Date.now() - start;

        if (result && typeof result === 'object') {
          Object.assign(workingPayload, result);
        }

        this.emit('hook:invoke_success', {
          domain,
          event,
          hookId: hook.id,
          pluginId: hook.pluginId,
          elapsedMs,
          changedPayload: Boolean(result && typeof result === 'object'),
          patch: toEventJson(result ?? null),
          at: new Date().toISOString(),
        });
      } catch (error) {
        const elapsedMs = Date.now() - start;
        const message = error instanceof Error ? error.message : String(error);
        const timedOut = message.includes('timed out');

        failures.push({
          pluginId: hook.pluginId,
          hookId: hook.id,
          domain,
          event,
          elapsedMs,
          message,
          timedOut
        });

        this.logger.warn('Hook execution failed but was isolated', {
          pluginId: hook.pluginId,
          hookId: hook.id,
          domain,
          event,
          elapsedMs,
          message,
          timedOut
        });

        this.emit('hook:invoke_failure', {
          domain,
          event,
          hookId: hook.id,
          pluginId: hook.pluginId,
          elapsedMs,
          message: truncate(message),
          timedOut,
          at: new Date().toISOString(),
        });
      }
    }

    this.emit('hook:dispatch_end', {
      domain,
      event,
      hooksCount: applicableHooks.length,
      failuresCount: failures.length,
      elapsedMs: Date.now() - dispatchStartedAt,
      context: toEventJson(contextToEvent(context)),
      finalPayload: toEventJson(workingPayload),
      at: new Date().toISOString(),
    });

    return {
      initialPayload: payload,
      finalPayload: workingPayload,
      failures
    };
  }
}
