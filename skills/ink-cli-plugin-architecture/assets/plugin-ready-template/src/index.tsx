import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { Kernel } from './core/kernel.js';
import { getPlugins } from './plugins/index.js';
import { echoTool } from './tools/echo-tool.js';
import { shellTool } from './tools/shell-tool.js';

const kernel = new Kernel();
await kernel.loadPlugins(getPlugins());

await kernel.loadPlugins([
  {
    id: 'builtin-tools',
    setup(api) {
      api.registerTool(echoTool);
      api.registerTool(shellTool);
    },
  },
]);

render(<App kernel={kernel} />);
