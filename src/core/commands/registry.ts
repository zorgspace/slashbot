/**
 * Command Registry - Manages command handlers with DI support
 */

import 'reflect-metadata';
import { injectable } from 'inversify';
import type { Container } from 'inversify';

export interface CommandHandler {
  name: string;
  description: string;
  usage: string;
  aliases?: string[];
  group?: string;
  execute: (args: string[], context: CommandContext) => Promise<boolean>;
}

export interface ConnectorHandle {
  isRunning: () => boolean;
  sendMessage: (msg: string) => Promise<void>;
  stop?: () => void;
}

import type { GrokClient } from '../api';
import type { TaskScheduler } from '../scheduler/scheduler';
import type { SecureFileSystem } from '../services/filesystem';
import type { ConfigManager } from '../config/config';
import type { CodeEditor } from '../code/editor';
import type { TUIApp } from '../ui/TUIApp';
import type { Interface as ReadlineInterface } from 'readline';

export interface CommandContext {
  grokClient: GrokClient | null;
  scheduler: TaskScheduler;
  fileSystem: SecureFileSystem;
  configManager: ConfigManager;
  codeEditor: CodeEditor;
  container: Container;
  connectors: Map<string, ConnectorHandle>;
  reinitializeGrok: () => Promise<void>;
  rl?: ReadlineInterface;
  tuiApp?: TUIApp;
}

@injectable()
export class CommandRegistry {
  // Public for help command reference
  readonly commands: Map<string, CommandHandler> = new Map();

  /**
   * Register a command handler
   */
  register(handler: CommandHandler): void {
    this.commands.set(handler.name, handler);
    // Register aliases
    if (handler.aliases) {
      for (const alias of handler.aliases) {
        this.commands.set(alias, handler);
      }
    }
  }

  /**
   * Register multiple handlers
   */
  registerAll(handlers: CommandHandler[]): void {
    for (const handler of handlers) {
      this.register(handler);
    }
  }

  /**
   * Get a command by name
   */
  get(name: string): CommandHandler | undefined {
    return this.commands.get(name);
  }

  /**
   * Check if a command exists
   */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Get all unique commands (excludes aliases)
   */
  getAll(): CommandHandler[] {
    const seen = new Set<string>();
    const result: CommandHandler[] = [];
    for (const handler of this.commands.values()) {
      if (!seen.has(handler.name)) {
        seen.add(handler.name);
        result.push(handler);
      }
    }
    return result;
  }

  /**
   * Get all command names (for autocomplete)
   */
  getNames(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * Execute a command
   */
  async execute(name: string, args: string[], context: CommandContext): Promise<boolean> {
    const handler = this.commands.get(name);
    if (!handler) {
      return false;
    }
    return handler.execute(args, context);
  }
}
