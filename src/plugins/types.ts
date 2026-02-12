/**
 * Plugin Types - Common interfaces for plugin system
 */

import type { Container } from 'inversify';
import type { z } from 'zod/v4';

export interface PluginMetadata {
  id: string;
  name: string;
  version: string;
  category: string;
  description: string;
  dependencies?: string[];
  /** When false, prompt contributions and interactions are excluded from conversation context. Defaults to true. */
  contextInject?: boolean;
}

export interface PluginContext {
  container: Container;
  eventBus?: unknown;
  configManager?: { getConfig: () => unknown };
  workDir?: string;
  getGrokClient?: () => unknown;
}

export interface ActionContribution {
  type: string;
  tagName: string;
  handler: Record<string, Function>;
  execute: (action: any, handlers: any) => any;
}

export interface PromptContribution {
  id: string;
  title: string;
  priority: number;
  content?: string | Function | readonly string[];
  enabled?: boolean | Function;
}

export interface ContextProvider {
  id?: string;
  label?: string;
  priority?: number;
  isActive?: () => boolean;
  getContext: () => Promise<string | null>;
}

export interface EventSubscription {
  event: string;
  handler: (...args: any[]) => void;
}

export interface SidebarContribution {
  id: string;
  label: string;
  order: number;
  getStatus: () => boolean;
}

export interface ToolContribution {
  /** Tool name exposed to the LLM, e.g. 'bash', 'read_file' */
  name: string;
  /** Description shown to the LLM */
  description: string;
  /** Zod schema for the tool parameters */
  parameters: z.ZodType<any>;
  /** Convert structured args from the LLM into an Action for the existing executor */
  toAction: (args: Record<string, unknown>) => import('../core/actions/types').Action;
  /** Control-flow hint: 'say' displays, 'end' stops the loop, 'continue' resets iteration */
  controlFlow?: 'say' | 'end' | 'continue';
}

export type KernelHookEvent =
  | 'startup:after-grok-ready'
  | 'startup:after-connectors-ready'
  | 'startup:after-ui-ready'
  | 'input:before'
  | 'input:after-command'
  | 'input:after'
  | 'run:noninteractive:before'
  | 'render:before'
  | 'render:after'
  | 'tabs:before'
  | 'tabs:after'
  | 'sidebar:before'
  | 'sidebar:after'
  | 'shutdown:before';

export type KernelHookPayload = Record<string, unknown>;

export interface KernelHookContribution {
  event: KernelHookEvent;
  /**
   * Lower number runs first. Defaults to 100.
   */
  order?: number;
  /**
   * Return a shallow patch object to update payload for downstream hooks/callers.
   */
  handler: (
    payload: KernelHookPayload,
    context: PluginContext,
  ) => void | Partial<KernelHookPayload> | Promise<void | Partial<KernelHookPayload>>;
}

export interface Plugin {
  readonly metadata: PluginMetadata;

  init(context: PluginContext): Promise<void>;

  getActionContributions(): ActionContribution[];

  getPromptContributions(): PromptContribution[];

  getCommandContributions?(): any[];

  destroy?(): Promise<void>;

  getContextProviders?(): ContextProvider[];

  getEventSubscriptions?(): EventSubscription[];

  getSidebarContributions?(): SidebarContribution[];

  getToolContributions?(): ToolContribution[];

  getKernelHooks?(): KernelHookContribution[];

  onBeforeGrokInit?(context: PluginContext): Promise<void>;

  onAfterGrokInit?(context: PluginContext): Promise<void>;
}

export type ConnectorPlugin = Plugin & {
  createConnector: (context: PluginContext) => Promise<unknown>;
};
