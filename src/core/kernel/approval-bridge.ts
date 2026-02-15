import type { ToolResult } from './contracts.js';

export interface ApprovalRequest {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  resolve: (result: ToolResult) => void;
}

/**
 * Bridges risky command approval with the React TUI layer.
 * The agentic-tools plugin pushes approval requests through the bridge;
 * the TUI renders an interactive prompt and resolves with the user's decision.
 */
export class ApprovalBridge {
  private listener: ((req: ApprovalRequest) => void) | null = null;

  onRequest(fn: (req: ApprovalRequest) => void): () => void {
    this.listener = fn;
    return () => { this.listener = null; };
  }

  request(command: string, args: string[], cwd: string): Promise<ToolResult> {
    return new Promise((resolve) => {
      const req: ApprovalRequest = {
        id: `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        command,
        args,
        cwd,
        resolve,
      };
      if (this.listener) {
        this.listener(req);
      } else {
        // Headless mode: deny by default
        resolve({
          ok: false,
          error: {
            code: 'APPROVAL_DENIED',
            message: `Command "${command} ${args.join(' ')}" requires approval but no TUI is active. Run in interactive mode to approve risky commands.`,
          },
        });
      }
    });
  }
}
