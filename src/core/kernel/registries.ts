import type {
  ChannelDefinition,
  CommandDefinition,
  GatewayMethodDefinition,
  HttpRouteDefinition,
  IndicatorStatus,
  JsonValue,
  ProviderDefinition,
  ServiceDefinition,
  StatusIndicatorContribution,
  StructuredLogger,
  ToolDefinition
} from './contracts.js';

function failDuplicate(kind: string, id: string): never {
  throw new Error(`${kind} already registered: ${id}`);
}

export class Registry<T extends { id: string }> {
  private readonly items = new Map<string, T>();

  constructor(private readonly kind: string) {}

  register(item: T): void {
    if (this.items.has(item.id)) {
      failDuplicate(this.kind, item.id);
    }
    this.items.set(item.id, item);
  }

  upsert(item: T): void {
    this.items.set(item.id, item);
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  list(): T[] {
    return [...this.items.values()];
  }
}

export class ToolRegistry extends Registry<ToolDefinition> {
  constructor() { super('Tool'); }

  override register<TArgs extends JsonValue>(tool: ToolDefinition<TArgs>): void {
    super.register(tool as ToolDefinition);
  }
}

export class CommandRegistry extends Registry<CommandDefinition> {
  constructor() { super('Command'); }
}

export class ProviderRegistry extends Registry<ProviderDefinition> {
  constructor() { super('Provider'); }
}

export class GatewayMethodRegistry extends Registry<GatewayMethodDefinition> {
  constructor() { super('Gateway method'); }
}

export class ChannelRegistry extends Registry<ChannelDefinition> {
  constructor() { super('Channel'); }
}

export class HttpRouteRegistry {
  private readonly routes: HttpRouteDefinition[] = [];

  register(route: HttpRouteDefinition): void {
    const duplicate = this.routes.find((item) => item.method === route.method && item.path === route.path);
    if (duplicate) {
      failDuplicate('HTTP route', `${route.method}:${route.path}`);
    }
    this.routes.push(route);
  }

  list(): HttpRouteDefinition[] {
    return [...this.routes];
  }
}

export class ServiceRegistry {
  private readonly services = new Map<string, ServiceDefinition<unknown>>();

  register<T>(service: ServiceDefinition<T>): void {
    if (this.services.has(service.id)) {
      failDuplicate('Service', service.id);
    }
    this.services.set(service.id, service as ServiceDefinition<unknown>);
  }

  upsert<T>(service: ServiceDefinition<T>): void {
    this.services.set(service.id, service as ServiceDefinition<unknown>);
  }

  get<T>(serviceId: string): T | undefined {
    const service = this.services.get(serviceId);
    return service?.implementation as T | undefined;
  }

  list(): ServiceDefinition<unknown>[] {
    return [...this.services.values()];
  }
}

export class StatusIndicatorRegistry {
  private readonly indicators: StatusIndicatorContribution[] = [];
  private readonly statuses = new Map<string, IndicatorStatus>();
  private readonly listeners = new Set<() => void>();

  register(indicator: StatusIndicatorContribution): void {
    if (this.indicators.some(i => i.id === indicator.id)) {
      failDuplicate('StatusIndicator', indicator.id);
    }
    this.indicators.push(indicator);
    this.statuses.set(indicator.id, indicator.getInitialStatus());
  }

  updateStatus(id: string, status: IndicatorStatus): void {
    if (this.statuses.get(id) === status) return;
    this.statuses.set(id, status);
    for (const listener of this.listeners) listener();
  }

  getStatus(id: string): IndicatorStatus {
    return this.statuses.get(id) ?? 'disconnected';
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  list(): StatusIndicatorContribution[] {
    return [...this.indicators].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
  }

  findByConnectorName(name: string): StatusIndicatorContribution | undefined {
    return this.indicators.find(i => i.connectorName === name);
  }
}

export function safeRegister(
  logger: StructuredLogger,
  operationName: string,
  fn: () => void
): { ok: true } | { ok: false; reason: string } {
  try {
    fn();
    return { ok: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error(`${operationName} failed`, { reason });
    return { ok: false, reason };
  }
}
