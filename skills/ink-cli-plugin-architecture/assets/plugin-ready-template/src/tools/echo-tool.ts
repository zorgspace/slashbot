import type { ToolAdapter, ToolResult } from '../core/contracts.js';

export const echoTool: ToolAdapter = {
  id: 'echo',
  async execute(args: string[]): Promise<ToolResult> {
    return {
      code: 0,
      stdout: args.join(' '),
      stderr: '',
    };
  },
};
