/**
 * Grok API Utilities
 */

/**
 * Format action results for LLM context
 * No truncation - send full results to the LLM
 */
export function compressActionResults(
  results: Array<{ action: string; result: string; success: boolean; error?: string }>,
): string {
  return results
    .map(r => {
      const status = r.success ? '✓' : '✗';
      const errorNote = r.error ? ` (${r.error})` : '';
      return `[${status}] ${r.action}${errorNote}\n${r.result}`;
    })
    .join('\n\n');
}

/**
 * Generate environment information string
 */
export function getEnvironmentInfo(workDir: string): string {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  const cwd = workDir || process.cwd();
  const isGitRepo = fs.existsSync(path.join(cwd, '.git'));
  const platform = process.platform;
  const osVersion = `${os.type()} ${os.release()}`;
  const today = new Date().toISOString().split('T')[0];

  return `
<env>
Working directory: ${cwd}
Is directory a git repo: ${isGitRepo ? 'Yes' : 'No'}
Platform: ${platform}
OS Version: ${osVersion}
Today's date: ${today}
</env>`;
}
