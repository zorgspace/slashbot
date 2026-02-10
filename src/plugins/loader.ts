/**
 * Plugin Loader - Static imports of all plugin modules
 *
 * All plugins are imported and instantiated here.
 * The loader returns them in a flat array for the registry to sort by dependencies.
 */

import type { Plugin } from './types';

// Core plugins
import { CorePromptPlugin } from './core-prompt';
import { ProvidersPlugin } from './providers';
import { BashPlugin } from './bash';
import { SayPlugin } from './say';
import { FilesystemPlugin } from './filesystem';
import { CodeEditorPlugin } from './code-editor';
import { WebPlugin } from './web';
import { SystemPlugin } from './system';
import { SessionPlugin } from './session';
import { TUIPlugin } from './tui';

// Feature plugins
import { ExplorePlugin } from './explore';
import { PlanningPlugin } from './planning';
import { SkillsPlugin } from './skills';
import { SchedulingPlugin } from './scheduling';
import { HeartbeatPlugin } from './heartbeat';
import { WalletPlugin } from './wallet';
import { TodoPlugin } from './todo';
import { QuestionPlugin } from './question';
import { GitPlugin } from './git';
import { SubagentPlugin } from './subagent';
import { MCPPlugin } from './mcp';
import { TranscriptionPlugin } from './transcription';

// Connector plugins
import { TelegramPlugin } from '../connectors/telegram';
import { DiscordPlugin } from '../connectors/discord';

/**
 * Load all built-in plugins
 */
export function loadBuiltinPlugins(): Plugin[] {
  return [
    // Core (always loaded, no deps)
    new CorePromptPlugin(),
    new ProvidersPlugin(),
    new BashPlugin(),
    new SayPlugin(),
    new FilesystemPlugin(),
    new CodeEditorPlugin(),
    new WebPlugin(),
    new SystemPlugin(),
    new SessionPlugin(),
    new TUIPlugin(),

    // Features
    new ExplorePlugin(),
    new PlanningPlugin(),
    new SkillsPlugin(),
    new SchedulingPlugin(),
    new HeartbeatPlugin(),
    new WalletPlugin(),
    new TodoPlugin(),
    new QuestionPlugin(),
    new GitPlugin(),
    new SubagentPlugin(),
    new MCPPlugin(),
    new TranscriptionPlugin(),

    // Connectors
    new TelegramPlugin(),
    new DiscordPlugin(),
  ];
}

/**
 * Load all plugins
 */
export function loadAllPlugins(): Plugin[] {
  return loadBuiltinPlugins();
}