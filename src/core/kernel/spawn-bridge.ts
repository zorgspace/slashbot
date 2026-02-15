import type { ToolResult } from './contracts.js';

export interface SpawnRequest {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
  resolve: (result: ToolResult) => void;
}

/**
 * Bridges imperative tool execution with the React TUI layer.
 * Tools push spawn requests through the bridge; the TUI renders
 * them via ink-spawn and resolves with captured output.
 */
export class SpawnBridge {
  private listener: ((req: SpawnRequest) => void) | null = null;

  onRequest(fn: (req: SpawnRequest) => void): () => void {
    this.listener = fn;
    return () => { this.listener = null; };
  }

  request(command: string, args: string[], cwd: string, timeoutMs: number, abortSignal?: AbortSignal): Promise<ToolResult> {
    return new Promise((resolve) => {
      const req: SpawnRequest = {
        id: `spawn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        command,
        args,
        cwd,
        timeoutMs,
        abortSignal,
        resolve,
      };
      if (this.listener) {
        this.listener(req);
      } else {
        resolve({
          ok: false,
          error: { code: 'NO_SPAWN_HANDLER', message: 'No spawn handler registered (non-TUI context)' }
        });
      }
    });
  }
}
