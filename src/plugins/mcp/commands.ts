import { display } from '../../core/ui';
import type { CommandHandler } from '../../core/commands/registry';
import type { MCPManager } from './manager';
import type { MCPServerConfig, MCPServerStatus, MCPRemoteServerConfig } from './types';
import { MCPAuthStorage } from './auth';
import { MCPOAuthProvider } from './oauth-provider';
import { waitForCallback, stop as stopCallbackServer } from './oauth-callback';
import { promptPassword } from '../../core/utils/input';

let mcpManagerRef: MCPManager | null = null;
const authStorage = new MCPAuthStorage();

export function setMCPManagerForCommands(manager: MCPManager): void {
  mcpManagerRef = manager;
}

function statusIcon(s: MCPServerStatus): string {
  switch (s.status) {
    case 'connected': return '[*]';
    case 'disabled': return '[-]';
    case 'needs_auth': return '[!]';
    case 'needs_client_registration': return '[!]';
    default: return '[ ]';
  }
}

function statusText(s: MCPServerStatus): string {
  switch (s.status) {
    case 'connected': return `connected (${s.toolCount} tools)`;
    case 'disabled': return 'disabled';
    case 'disconnected': return 'disconnected';
    case 'failed': return `failed: ${s.error}`;
    case 'needs_auth': return 'needs auth (/mcp auth <name>)';
    case 'needs_client_registration': return `needs registration: ${s.error}`;
  }
}

/**
 * Authenticate with a Personal Access Token (PAT).
 * Stores the token as a header in the server config and reconnects.
 */
async function handleTokenAuth(name: string, config: MCPRemoteServerConfig): Promise<boolean> {
  display.append('');
  display.violet(`Enter access token for ${name}:`);
  const token = await promptPassword('  Token: ');

  if (!token) {
    display.muted('Cancelled.');
    return true;
  }

  // Use PRIVATE-TOKEN for GitLab, Authorization: Bearer for others
  const headers = { ...(config.headers || {}) };
  if (config.url.includes('gitlab')) {
    headers['PRIVATE-TOKEN'] = token;
  } else {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Update server config with auth header
  const newConfig: MCPRemoteServerConfig = { ...config, headers };
  await mcpManagerRef!.addServer(name, newConfig);

  display.muted(`Connecting to ${name}...`);
  try {
    await mcpManagerRef!.reconnect(name);
    const tools = mcpManagerRef!.getAllTools().filter(t => t.serverName === name);
    display.successText(`Connected to ${name} (${tools.length} tools)`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    display.errorText(`Connection failed: ${msg}`);
  }
  return true;
}

export const mcpListCommand: CommandHandler = {
  name: 'mcp',
  description: 'MCP server management',
  usage: '/mcp [list|add|remove|restart|auth|logout]',
  group: 'MCP',
  subcommands: ['list', 'add', 'remove', 'restart', 'auth', 'logout', 'call'],
  execute: async (args) => {
    if (!mcpManagerRef) {
      display.errorText('MCP not initialized.');
      return true;
    }

    const subcommand = args[0] || 'list';

    if (subcommand === 'list') {
      const configured = mcpManagerRef.getConfiguredServers();
      const statuses = mcpManagerRef.getAllStatuses();
      const tools = mcpManagerRef.getAllTools();

      display.append('');
      display.violet('MCP Servers');
      display.append('');

      if (configured.length === 0) {
        display.muted('  No servers configured.');
        display.muted('  Add one with: /mcp add <name> <command> [args...]');
      } else {
        for (const name of configured) {
          const s = statuses.get(name) ?? { status: 'disconnected' as const };
          const serverTools = tools.filter(t => t.serverName === name);
          display.append(`  ${statusIcon(s)} ${name} — ${statusText(s)}`);
          if (s.status === 'connected' && serverTools.length > 0) {
            for (const tool of serverTools.slice(0, 5)) {
              display.muted(`      ${tool.name}: ${tool.description.slice(0, 60)}`);
            }
            if (serverTools.length > 5) {
              display.muted(`      ... and ${serverTools.length - 5} more`);
            }
          }
        }
      }
      display.append('');
      return true;
    }

    if (subcommand === 'add') {
      const name = args[1];
      const commandOrUrl = args[2];
      if (!name || !commandOrUrl) {
        display.muted('Usage: /mcp add <name> <command> [args...]');
        display.muted('       /mcp add <name> <url>');
        return true;
      }

      const isUrl = commandOrUrl.startsWith('http://') || commandOrUrl.startsWith('https://');
      const config: MCPServerConfig = isUrl
        ? { type: 'remote' as const, url: commandOrUrl }
        : { command: commandOrUrl, args: args.slice(3) };

      await mcpManagerRef.addServer(name, config);
      try {
        await mcpManagerRef.connect(name, config);
        const tools = mcpManagerRef.getAllTools().filter(t => t.serverName === name);
        display.successText(`Added and connected to ${name} (${tools.length} tools)`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (isUrl && msg.includes('auth')) {
          display.warningText(`Added ${name} — authentication required: /mcp auth ${name}`);
        } else {
          display.warningText(`Added ${name} but connection failed: ${msg}`);
        }
      }
      return true;
    }

    if (subcommand === 'remove') {
      const name = args[1];
      if (!name) {
        display.muted('Usage: /mcp remove <name>');
        return true;
      }
      await mcpManagerRef.removeServer(name);
      await authStorage.remove(name);
      display.successText(`Removed ${name}`);
      return true;
    }

    if (subcommand === 'restart') {
      const name = args[1];
      if (!name) {
        display.muted('Usage: /mcp restart <name>');
        return true;
      }
      if (!mcpManagerRef.getConfiguredServers().includes(name)) {
        display.errorText(`Server '${name}' not configured.`);
        return true;
      }
      display.muted(`Restarting ${name}...`);
      try {
        await mcpManagerRef.reconnect(name);
        const tools = mcpManagerRef.getAllTools().filter(t => t.serverName === name);
        display.successText(`Restarted ${name} (${tools.length} tools)`);
      } catch (error) {
        display.errorText(`Restart failed: ${error}`);
      }
      return true;
    }

    if (subcommand === 'auth') {
      const name = args[1];
      if (!name) {
        display.muted('Usage: /mcp auth <name> [token]');
        display.muted('  /mcp auth <name>         — try OAuth, fallback to token');
        display.muted('  /mcp auth <name> token   — use access token directly');
        return true;
      }

      const config = mcpManagerRef.getServerConfig(name);
      if (!config) {
        display.errorText(`Server '${name}' not configured.`);
        return true;
      }
      if (!('url' in config) || !(config as any).url) {
        display.errorText(`Server '${name}' is not a remote server.`);
        return true;
      }

      const remoteConfig = config as MCPRemoteServerConfig;

      // Direct token auth: /mcp auth <name> token
      if (args[2] === 'token' || args[2] === 'pat' || remoteConfig.oauth === false) {
        return handleTokenAuth(name, remoteConfig);
      }

      // Try OAuth flow first
      display.muted(`Starting OAuth for ${name}...`);

      let redirectShown = false;
      const provider = new MCPOAuthProvider(
        name,
        remoteConfig.url,
        authStorage,
        remoteConfig.oauth || undefined,
        (url: URL) => {
          redirectShown = true;
          display.append('');
          display.violet('Open this URL to authorize:');
          display.append(`  ${url.toString()}`);
          display.append('');
        },
      );

      mcpManagerRef.setAuthProvider(name, provider);

      try {
        // Get state for CSRF protection
        const state = await provider.state();
        const codePromise = waitForCallback(state);

        // Reconnect - will trigger OAuth redirect if server supports it
        try {
          await mcpManagerRef.reconnect(name);
          // If reconnect succeeds without needing auth, we're done
          stopCallbackServer();
          display.successText(`${name} connected (no auth needed)`);
          return true;
        } catch {
          // Expected - needs auth
        }

        // If OAuth redirect was NOT shown, the server doesn't support OAuth discovery.
        // Fall back to token-based auth.
        if (!redirectShown) {
          stopCallbackServer();
          display.muted('OAuth not available for this server. Falling back to token auth.');
          return handleTokenAuth(name, remoteConfig);
        }

        display.muted('Waiting for authorization (5 min timeout)...');
        const code = await codePromise;

        await mcpManagerRef.finishAuth(name, code);
        stopCallbackServer();

        const tools = mcpManagerRef.getAllTools().filter(t => t.serverName === name);
        display.successText(`Authorized and connected to ${name} (${tools.length} tools)`);
      } catch (error) {
        stopCallbackServer();
        const msg = error instanceof Error ? error.message : String(error);
        display.errorText(`Auth failed: ${msg}`);
      }
      return true;
    }

    if (subcommand === 'logout') {
      const name = args[1];
      if (!name) {
        display.muted('Usage: /mcp logout <name>');
        return true;
      }
      await mcpManagerRef.logout(name);
      await authStorage.remove(name);
      // Also clear auth headers from config
      const config = mcpManagerRef.getServerConfig(name);
      if (config && 'url' in config) {
        const remoteConfig = config as MCPRemoteServerConfig;
        if (remoteConfig.headers) {
          const { 'PRIVATE-TOKEN': _, 'Authorization': __, ...rest } = remoteConfig.headers;
          const newConfig: MCPRemoteServerConfig = { ...remoteConfig, headers: Object.keys(rest).length > 0 ? rest : undefined };
          await mcpManagerRef.addServer(name, newConfig);
        }
      }
      display.successText(`Logged out from ${name}`);
      return true;
    }

    if (subcommand === 'call') {
      const toolName = args[1];
      if (!toolName) {
        display.muted('Usage: /mcp call <tool> [json_args]');
        return true;
      }

      const serverName = mcpManagerRef.findToolServer(toolName);
      if (!serverName) {
        display.errorText(`Tool '${toolName}' not found on any connected server.`);
        return true;
      }

      let toolArgs: Record<string, unknown> = {};
      const jsonStr = args.slice(2).join(' ').trim();
      if (jsonStr) {
        try {
          toolArgs = JSON.parse(jsonStr);
        } catch {
          display.errorText('Invalid JSON arguments.');
          display.muted('Usage: /mcp call <tool> {"key": "value"}');
          return true;
        }
      }

      display.muted(`Calling ${toolName} on ${serverName}...`);
      try {
        const result = await mcpManagerRef.callTool(serverName, toolName, toolArgs);
        display.append('');
        display.violet(`Result from ${toolName}:`);
        if (result.content && Array.isArray(result.content)) {
          for (const item of result.content) {
            if (item.type === 'text') {
              display.append(item.text);
            } else {
              display.append(JSON.stringify(item, null, 2));
            }
          }
        } else {
          display.append(JSON.stringify(result, null, 2));
        }
        display.append('');
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        display.errorText(`Call failed: ${msg}`);
      }
      return true;
    }

    display.muted('Unknown subcommand. Use: list, add, remove, restart, auth, logout, call');
    return true;
  },
};

export const mcpCommands: CommandHandler[] = [mcpListCommand];
