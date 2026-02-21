import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@slashbot/core': resolve(rootDir, 'src/core'),
      '@slashbot/providers': resolve(rootDir, 'src/providers'),
      '@slashbot/ui': resolve(rootDir, 'src/ui'),
      '@slashbot/plugin-sdk': resolve(rootDir, 'src/plugin-sdk/index.d.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts']
  }
});
