export interface MCPLocalServerConfig {
  type?: 'local';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
}

export interface MCPRemoteServerConfig {
  type: 'remote';
  url: string;
  headers?: Record<string, string>;
  oauth?: MCPOAuthConfig | false;
  enabled?: boolean;
  timeout?: number;
}

export interface MCPOAuthConfig {
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

export type MCPServerConfig = MCPLocalServerConfig | MCPRemoteServerConfig;

export type MCPServerStatus =
  | { status: 'connected'; toolCount: number }
  | { status: 'disabled' }
  | { status: 'disconnected' }
  | { status: 'failed'; error: string }
  | { status: 'needs_auth' }
  | { status: 'needs_client_registration'; error: string };

export interface MCPConfig {
  servers: Record<string, MCPServerConfig>;
}

export interface MCPToolInfo {
  name: string;
  description: string;
  inputSchema: any;
  serverName: string;
}

export interface MCPToolAction {
  type: 'mcp-tool';
  toolName: string;
  serverName: string;
  args: Record<string, unknown>;
}
