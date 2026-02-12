/**
 * Plugin Registry - Manages plugin lifecycle, dependency resolution, and contribution collection
 */

import type {
  Plugin,
  PluginContext,
  PluginMetadata,
  ActionContribution,
  PromptContribution,
  ContextProvider,
  EventSubscription,
  SidebarContribution,
  ToolContribution,
  KernelHookContribution,
  KernelHookEvent,
  KernelHookPayload,
} from './types';
import type { CommandHandler } from '../core/commands/registry';

export class PluginRegistry {
  private plugins: Map<string, Plugin> = new Map();
  private initialized: Set<string> = new Set();
  private context: PluginContext | null = null;

  /**
   * Register a plugin (does not initialize it)
   */
  register(plugin: Plugin): void {
    const { id } = plugin.metadata;
    if (this.plugins.has(id)) {
      throw new Error(`Plugin '${id}' is already registered`);
    }
    this.plugins.set(id, plugin);
  }

  /**
   * Register multiple plugins
   */
  registerAll(plugins: Plugin[]): void {
    for (const plugin of plugins) {
      this.register(plugin);
    }
  }

  /**
   * Set the plugin context (must be called before initAll)
   */
  setContext(context: PluginContext): void {
    this.context = context;
  }

  /**
   * Initialize all registered plugins in dependency order
   */
  async initAll(): Promise<void> {
    if (!this.context) {
      throw new Error('Plugin context not set. Call setContext() first.');
    }

    const sorted = this.topologicalSort();
    for (const id of sorted) {
      await this.initPlugin(id);
    }
  }

  /**
   * Initialize a single plugin by ID
   */
  private async initPlugin(id: string): Promise<void> {
    if (this.initialized.has(id)) return;

    const plugin = this.plugins.get(id);
    if (!plugin) {
      throw new Error(`Plugin '${id}' not found`);
    }

    // Ensure dependencies are initialized
    const deps = plugin.metadata.dependencies || [];
    for (const depId of deps) {
      if (!this.initialized.has(depId)) {
        await this.initPlugin(depId);
      }
    }

    await plugin.init(this.context!);
    this.initialized.add(id);
  }

  /**
   * Destroy all plugins in reverse order
   */
  async destroyAll(): Promise<void> {
    const sorted = this.topologicalSort().reverse();
    for (const id of sorted) {
      const plugin = this.plugins.get(id);
      if (plugin?.destroy) {
        await plugin.destroy();
      }
    }
    this.initialized.clear();
  }

  /**
   * Topological sort of plugins based on dependencies
   */
  private topologicalSort(): string[] {
    const sorted: string[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new Error(`Circular dependency detected involving plugin '${id}'`);
      }

      visiting.add(id);
      const plugin = this.plugins.get(id);
      if (plugin) {
        for (const depId of plugin.metadata.dependencies || []) {
          if (this.plugins.has(depId)) {
            visit(depId);
          }
        }
      }
      visiting.delete(id);
      visited.add(id);
      sorted.push(id);
    };

    for (const id of this.plugins.keys()) {
      visit(id);
    }

    return sorted;
  }

  // ===== Contribution Collectors =====

  /**
   * Collect all action contributions from initialized plugins
   */
  getActionContributions(): ActionContribution[] {
    const contributions: ActionContribution[] = [];
    for (const [id, plugin] of this.plugins) {
      if (!this.initialized.has(id)) continue;
      const actions = plugin.getActionContributions?.() || [];
      contributions.push(...actions);
    }
    return contributions;
  }

  /**
   * Collect all command contributions from initialized plugins
   */
  getCommandContributions(): CommandHandler[] {
    const contributions: CommandHandler[] = [];
    for (const [id, plugin] of this.plugins) {
      if (!this.initialized.has(id)) continue;
      const commands = plugin.getCommandContributions?.() || [];
      contributions.push(...commands);
    }
    return contributions;
  }

  /**
   * Collect all prompt contributions from initialized plugins, sorted by priority
   */
  getPromptContributions(): PromptContribution[] {
    const contributions: PromptContribution[] = [];
    for (const [id, plugin] of this.plugins) {
      if (!this.initialized.has(id)) continue;
      if (plugin.metadata.contextInject === false) continue;
      const prompts = plugin.getPromptContributions?.() || [];
      contributions.push(...prompts);
    }
    return contributions.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Collect all context providers from initialized plugins, sorted by priority
   */
  getContextProviders(): ContextProvider[] {
    const providers: ContextProvider[] = [];
    for (const [id, plugin] of this.plugins) {
      if (!this.initialized.has(id)) continue;
      if (plugin.metadata.contextInject === false) continue;
      const ctxProviders = plugin.getContextProviders?.() || [];
      providers.push(...ctxProviders);
    }
    return providers.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  /**
   * Collect all event subscriptions from initialized plugins
   */
  getEventSubscriptions(): EventSubscription[] {
    const subscriptions: EventSubscription[] = [];
    for (const [id, plugin] of this.plugins) {
      if (!this.initialized.has(id)) continue;
      const events = plugin.getEventSubscriptions?.() || [];
      subscriptions.push(...events);
    }
    return subscriptions;
  }

  /**
   * Collect all sidebar contributions from initialized plugins, sorted by order
   */
  getSidebarContributions(): SidebarContribution[] {
    const contributions: SidebarContribution[] = [];
    for (const [id, plugin] of this.plugins) {
      if (!this.initialized.has(id)) continue;
      const sidebar = plugin.getSidebarContributions?.() || [];
      contributions.push(...sidebar);
    }
    return contributions.sort((a, b) => a.order - b.order);
  }

  /**
   * Collect all tool contributions from initialized plugins
   */
  getToolContributions(): ToolContribution[] {
    const contributions: ToolContribution[] = [];
    for (const [id, plugin] of this.plugins) {
      if (!this.initialized.has(id)) continue;
      const tools = plugin.getToolContributions?.() || [];
      contributions.push(...tools);
    }
    return contributions;
  }

  /**
   * Collect all kernel hook contributions from initialized plugins.
   */
  getKernelHooks(event?: KernelHookEvent): KernelHookContribution[] {
    const contributions: Array<KernelHookContribution & { _pluginId: string }> = [];
    for (const [id, plugin] of this.plugins) {
      if (!this.initialized.has(id)) continue;
      const hooks = plugin.getKernelHooks?.() || [];
      for (const hook of hooks) {
        if (!event || hook.event === event) {
          contributions.push({ ...hook, _pluginId: id });
        }
      }
    }
    contributions.sort((a, b) => {
      const orderA = a.order ?? 100;
      const orderB = b.order ?? 100;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a._pluginId.localeCompare(b._pluginId);
    });
    return contributions.map(({ _pluginId: _, ...hook }) => hook);
  }

  /**
   * Run all hooks for a kernel event and return the merged payload.
   * Hook handlers can return a shallow patch object to mutate downstream payload.
   */
  applyKernelHooks<T extends KernelHookPayload>(event: KernelHookEvent, payload: T): T {
    if (!this.context) {
      return payload;
    }
    let current = { ...payload } as T;
    const hooks = this.getKernelHooks(event);
    for (const hook of hooks) {
      try {
        const patch = hook.handler(current, this.context);
        if (patch && typeof (patch as Promise<unknown>).then === 'function') {
          void (patch as Promise<unknown>).catch(() => undefined);
          continue;
        }
        if (patch && typeof patch === 'object') {
          current = { ...current, ...(patch as Partial<T>) };
        }
      } catch {
        // Keep kernel resilient: a faulty plugin hook must not break core flows.
        continue;
      }
    }
    return current;
  }

  /**
   * Async variant of applyKernelHooks.
   * Use this when hooks may perform async side effects and/or return async patches.
   */
  async applyKernelHooksAsync<T extends KernelHookPayload>(
    event: KernelHookEvent,
    payload: T,
  ): Promise<T> {
    if (!this.context) {
      return payload;
    }
    let current = { ...payload } as T;
    const hooks = this.getKernelHooks(event);
    for (const hook of hooks) {
      try {
        const patch = await hook.handler(current, this.context);
        if (patch && typeof patch === 'object') {
          current = { ...current, ...(patch as Partial<T>) };
        }
      } catch {
        // Keep kernel resilient: a faulty plugin hook must not break core flows.
        continue;
      }
    }
    return current;
  }

  /**
   * Call a lifecycle hook on all initialized plugins
   */
  async callLifecycleHook(
    hook: 'onBeforeGrokInit' | 'onAfterGrokInit',
    context: PluginContext,
  ): Promise<void> {
    for (const [id, plugin] of this.plugins) {
      if (!this.initialized.has(id)) continue;
      await plugin[hook]?.(context);
    }
  }

  /**
   * Get a plugin by ID
   */
  get(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Check if a plugin is registered
   */
  has(id: string): boolean {
    return this.plugins.has(id);
  }

  /**
   * Check if a plugin is initialized
   */
  isInitialized(id: string): boolean {
    return this.initialized.has(id);
  }

  /**
   * Get all registered plugin metadata
   */
  getAll(): PluginMetadata[] {
    return Array.from(this.plugins.values()).map(p => p.metadata);
  }

  /**
   * Get plugins by category
   */
  getByCategory(category: PluginMetadata['category']): Plugin[] {
    return Array.from(this.plugins.values()).filter(p => p.metadata.category === category);
  }
}
