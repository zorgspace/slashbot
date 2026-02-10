/**
 * Git Context Provider - Adds git info to system prompt
 */

import type { ContextProvider } from '../types';

async function runGitSilent(args: string[]): Promise<string> {
  try {
    const proc = Bun.spawn(['git', ...args], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    return exitCode === 0 ? stdout.trim() : '';
  } catch {
    return '';
  }
}

export function getGitContextProvider(): ContextProvider {
  return {
    id: 'git-context',
    label: 'Git Context',
    priority: 5,
    isActive: () => {
      const fs = require('fs');
      const path = require('path');
      return fs.existsSync(path.join(process.cwd(), '.git'));
    },
    getContext: async () => {
      const [branch, status, log] = await Promise.all([
        runGitSilent(['branch', '--show-current']),
        runGitSilent(['status', '--short']),
        runGitSilent(['log', '--oneline', '-5']),
      ]);

      if (!branch) return null;

      const lines: string[] = [];
      lines.push(`Git branch: ${branch}`);
      if (status) {
        const fileCount = status.split('\n').filter(l => l.trim()).length;
        lines.push(`Working tree: ${fileCount} changed file${fileCount !== 1 ? 's' : ''}`);
      } else {
        lines.push('Working tree: clean');
      }
      if (log) {
        lines.push('Recent commits:');
        lines.push(log);
      }

      return lines.join('\n');
    },
  };
}
