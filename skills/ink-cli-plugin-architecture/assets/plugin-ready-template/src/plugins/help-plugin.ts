import type { InkPlugin } from '../core/contracts.js';

export const helpPlugin: InkPlugin = {
  id: 'help',
  setup(api) {
    api.registerCommand({
      id: 'help',
      description: 'List available commands',
      async run(ctx) {
        const tools = ctx.tools.list();
        return [
          'Type a command and press Enter.',
          'Built-in commands: help, echo <text>, shell <cmd> [args], tools',
          `Registered tools: ${tools.length ? tools.join(', ') : '(none)'}`,
        ].join('\n');
      },
    });

    api.registerCommand({
      id: 'tools',
      description: 'Show registered tool adapters',
      async run(ctx) {
        const tools = ctx.tools.list();
        return tools.length ? tools.join('\n') : 'No tools registered.';
      },
    });

    api.registerCommand({
      id: 'echo',
      description: 'Echo text via echo tool adapter',
      async run(ctx, args) {
        const tool = ctx.tools.get('echo');
        if (!tool) {
          return 'Tool not found: echo';
        }
        const result = await tool.execute(args);
        return result.code === 0 ? result.stdout : result.stderr;
      },
    });

    api.registerCommand({
      id: 'shell',
      description: 'Run a command through shell tool adapter',
      async run(ctx, args) {
        const tool = ctx.tools.get('shell');
        if (!tool) {
          return 'Tool not found: shell';
        }
        const result = await tool.execute(args);
        if (result.code === 0) {
          return result.stdout || '(no output)';
        }
        return [
          `Command failed with code ${result.code}.`,
          result.stderr || '(no stderr)',
          result.hint ? `Hint: ${result.hint}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      },
    });
  },
};
