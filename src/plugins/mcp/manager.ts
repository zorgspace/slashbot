/**
 * MCP Manager - Manages MCP server connections and tool discovery
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { MCPServerConfig, MCPServerStatus, MCPToolInfo, MCPLocalServerConfig, MCPRemoteServerConfig } from './types';
import { HOME_SLASHBOT_DIR } from '../../core/config/constants';
import * as path from 'path';

const DEFAULT_CONNECT_TIMEOUT = 30_000;
const DEFAULT_TOOL_TIMEOUT = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.then(r => { clearTimeout(timer); return r; }),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label ?? 'Operation'} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function isRemoteConfig(config: MCPServerConfig): config is MCPRemoteServerConfig {
  return config.type === 'remote' || (!('command' in config) && 'url' in config);
}

function normalizeConfig(raw: MCPServerConfig): MCPServerConfig {
  if (raw.type) return raw;
  if ('command' in raw && raw.command) return { ...raw, type: 'local' as const };
  if ('url' in raw && (raw as any).url) return { ...raw, type: 'remote' } as MCPRemoteServerConfig;
  return raw;
}

interface MCPConnection {
  client: Client;
  transport: Transport;
  tools: MCPToolInfo[];
  serverName: string;
}

const MCP_CONFIG_PATH = path.join(HOME_SLASHBOT_DIR, 'config', 'mcp.json');

export class MCPManager {
  private connections = new Map<string, MCPConnection>();
  private configs = new Map<string, MCPServerConfig>();
  private statuses = new Map<string, MCPServerStatus>();
  private authProviders = new Map<string, OAuthClientProvider>();
  private transports = new Map<string, StreamableHTTPClientTransport | SSEClientTransport>();

  /** Callback invoked when any server's tool list changes at runtime */
  onToolsChanged?: () => void;

  /**
   * Load MCP server configs from file
   */
  async loadConfig(): Promise<void> {
    try {
      const file = Bun.file(MCP_CONFIG_PATH);
      if (await file.exists()) {
        const config = await file.json();
        if (config.servers) {
          for (const [name, serverConfig] of Object.entries(config.servers)) {
            this.configs.set(name, normalizeConfig(serverConfig as MCPServerConfig));
          }
        }
      }
    } catch {
      // No config file or invalid JSON
    }
  }

  /**
   * Save MCP config to file
   */
  async saveConfig(): Promise<void> {
    const { mkdir } = await import('fs/promises');
    await mkdir(path.dirname(MCP_CONFIG_PATH), { recursive: true });

    const servers: Record<string, MCPServerConfig> = {};
    for (const [name, config] of this.configs) {
      servers[name] = config;
    }
    await Bun.write(MCP_CONFIG_PATH, JSON.stringify({ servers }, null, 2));
  }

  /**
   * Connect to all configured MCP servers in parallel
   */
  async connectAll(): Promise<void> {
    const entries = Array.from(this.configs.entries());
    const results = await Promise.allSettled(
      entries.map(([name, config]) => this.connect(name, config)),
    );
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        const name = entries[i][0];
        console.error(`[MCP] Failed to connect to ${name}: ${result.reason}`);
      }
    }
  }

  /**
   * Connect to a single MCP server
   */
  async connect(name: string, config: MCPServerConfig): Promise<void> {
    config = normalizeConfig(config);

    // Check enabled field
    if (config.enabled === false) {
      this.statuses.set(name, { status: 'disabled' });
      this.configs.set(name, config);
      return;
    }

    // Close existing client to prevent memory leak
    const existing = this.connections.get(name);
    if (existing) {
      try { await existing.client.close(); } catch { /* ignore */ }
      this.connections.delete(name);
    }

    this.statuses.set(name, { status: 'disconnected' });

    try {
      if (isRemoteConfig(config)) {
        await this.connectRemote(name, config);
      } else {
        await this.connectLocal(name, config as MCPLocalServerConfig);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.statuses.set(name, { status: 'failed', error: msg });
      throw error;
    }

    this.configs.set(name, config);
  }

  /**
   * Connect to a local stdio MCP server
   */
  private async connectLocal(name: string, config: MCPLocalServerConfig): Promise<void> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args || [],
      env: { ...process.env, ...(config.env || {}) } as Record<string, string>,
      stderr: 'pipe',
    });

    transport.stderr?.on('data', (chunk: Buffer) => {
      console.error(`[MCP:${name}] ${chunk.toString().trim()}`);
    });

    const client = this.createClient(name);
    await withTimeout(
      client.connect(transport),
      config.timeout ?? DEFAULT_CONNECT_TIMEOUT,
      `Connect to ${name}`,
    );

    await this.discoverAndStore(name, client, transport);
  }

  /**
   * Connect to a remote HTTP MCP server (StreamableHTTP first, SSE fallback)
   */
  private async connectRemote(name: string, config: MCPRemoteServerConfig): Promise<void> {
    const url = new URL(config.url);
    const authProvider = this.authProviders.get(name);
    const timeout = config.timeout ?? DEFAULT_CONNECT_TIMEOUT;

    // Try StreamableHTTP first
    try {
      const transport = new StreamableHTTPClientTransport(url, {
        authProvider,
        requestInit: config.headers ? { headers: config.headers } : undefined,
      });
      this.transports.set(name, transport);

      const client = this.createClient(name);
      await withTimeout(client.connect(transport), timeout, `Connect to ${name} (StreamableHTTP)`);
      await this.discoverAndStore(name, client, transport);
      return;
    } catch (error: any) {
      // If it's an auth error, don't fall back to SSE
      if (error?.constructor?.name === 'UnauthorizedError' || error?.message?.includes('Unauthorized')) {
        this.statuses.set(name, { status: 'needs_auth' });
        throw error;
      }
      // Otherwise fall through to SSE
    }

    // Fall back to SSE
    const transport = new SSEClientTransport(url, {
      authProvider,
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });
    this.transports.set(name, transport);

    const client = this.createClient(name);
    await withTimeout(client.connect(transport), timeout, `Connect to ${name} (SSE)`);
    await this.discoverAndStore(name, client, transport);
  }

  /**
   * Create an MCP Client with listChanged tool handlers
   */
  private createClient(name: string): Client {
    return new Client(
      { name: `slashbot-${name}`, version: '1.0.0' },
      {
        capabilities: {},
        listChanged: {
          tools: {
            onChanged: (_error, tools) => {
              const conn = this.connections.get(name);
              if (conn && tools) {
                conn.tools = tools.map(t => ({
                  name: t.name,
                  description: t.description || '',
                  inputSchema: t.inputSchema || {},
                  serverName: name,
                }));
                this.statuses.set(name, { status: 'connected', toolCount: conn.tools.length });
                this.onToolsChanged?.();
              }
            },
          },
        },
      },
    );
  }

  /**
   * Discover tools and store connection
   */
  private async discoverAndStore(name: string, client: Client, transport: Transport): Promise<void> {
    const toolsResult = await client.listTools();
    const tools: MCPToolInfo[] = (toolsResult.tools || []).map((tool: any) => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema || {},
      serverName: name,
    }));

    this.connections.set(name, { client, transport, tools, serverName: name });
    this.statuses.set(name, { status: 'connected', toolCount: tools.length });
  }

  /**
   * Call a tool on an MCP server with timeout and schema validation
   */
  async callTool(serverName: string, toolName: string, args: any): Promise<any> {
    const connection = this.connections.get(serverName);
    if (!connection) {
      throw new Error(`MCP server '${serverName}' not connected`);
    }

    const config = this.configs.get(serverName);
    const result = await connection.client.callTool(
      { name: toolName, arguments: args },
      CallToolResultSchema,
      { timeout: config?.timeout ?? DEFAULT_TOOL_TIMEOUT, resetTimeoutOnProgress: true },
    );
    return result;
  }

  /**
   * Get all available tools across all connected servers
   */
  getAllTools(): MCPToolInfo[] {
    const tools: MCPToolInfo[] = [];
    for (const conn of this.connections.values()) {
      tools.push(...conn.tools);
    }
    return tools;
  }

  /**
   * Find which server owns a tool
   */
  findToolServer(toolName: string): string | undefined {
    for (const conn of this.connections.values()) {
      if (conn.tools.some(t => t.name === toolName)) {
        return conn.serverName;
      }
    }
    return undefined;
  }

  /**
   * Get connected server names
   */
  getConnectedServers(): string[] {
    return Array.from(this.connections.keys());
  }

  /**
   * Get all configured server names (even if not connected)
   */
  getConfiguredServers(): string[] {
    return Array.from(this.configs.keys());
  }

  /**
   * Get status for all servers
   */
  getAllStatuses(): Map<string, MCPServerStatus> {
    // Fill in defaults for configured servers without a status
    for (const name of this.configs.keys()) {
      if (!this.statuses.has(name)) {
        this.statuses.set(name, { status: 'disconnected' });
      }
    }
    return this.statuses;
  }

  /**
   * Get status for a specific server
   */
  getServerStatus(name: string): MCPServerStatus {
    return this.statuses.get(name) ?? { status: 'disconnected' };
  }

  /**
   * Add a new server config
   */
  async addServer(name: string, config: MCPServerConfig): Promise<void> {
    this.configs.set(name, normalizeConfig(config));
    await this.saveConfig();
  }

  /**
   * Remove a server
   */
  async removeServer(name: string): Promise<void> {
    await this.disconnect(name);
    this.configs.delete(name);
    this.statuses.delete(name);
    await this.saveConfig();
  }

  /**
   * Disconnect from a server
   */
  async disconnect(name: string): Promise<void> {
    const connection = this.connections.get(name);
    if (connection) {
      try {
        await connection.client.close();
      } catch {
        // Ignore close errors
      }
      this.connections.delete(name);
    }
    this.transports.delete(name);
    this.statuses.set(name, { status: 'disconnected' });
  }

  /**
   * Get config for a server
   */
  getServerConfig(name: string): MCPServerConfig | undefined {
    return this.configs.get(name);
  }

  /**
   * Reconnect a server (disconnect then connect with existing config)
   */
  async reconnect(name: string): Promise<void> {
    const config = this.configs.get(name);
    if (!config) {
      throw new Error(`MCP server '${name}' not configured`);
    }
    await this.disconnect(name);
    await this.connect(name, config);
  }

  /**
   * Disconnect all servers
   */
  async disconnectAll(): Promise<void> {
    for (const name of Array.from(this.connections.keys())) {
      await this.disconnect(name);
    }
  }

  /**
   * Set an OAuth provider for a server (used before connecting)
   */
  setAuthProvider(name: string, provider: OAuthClientProvider): void {
    this.authProviders.set(name, provider);
  }

  /**
   * Finish OAuth flow for a remote server
   */
  async finishAuth(name: string, authorizationCode: string): Promise<void> {
    const transport = this.transports.get(name);
    if (transport && 'finishAuth' in transport) {
      await (transport as any).finishAuth(authorizationCode);
      // Reconnect to complete the flow
      await this.reconnect(name);
    }
  }

  /**
   * Clear auth and disconnect a server
   */
  async logout(name: string): Promise<void> {
    this.authProviders.delete(name);
    await this.disconnect(name);
  }
}
