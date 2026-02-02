/**
 * Grok API Utilities
 */

import { GROK_CONFIG } from '../config/constants';

/**
 * Format action results for LLM context
 * 256k context available - keep full results, only truncate extremely large outputs
 */
export function compressActionResults(
  results: Array<{ action: string; result: string; success: boolean; error?: string }>,
): string {
  return results
    .map(r => {
      const status = r.success ? '✓' : '✗';
      const errorNote = r.error ? ` (${r.error})` : '';

      const output =
        r.result.length > GROK_CONFIG.MAX_RESULT_CHARS
          ? r.result.slice(0, GROK_CONFIG.MAX_RESULT_CHARS) + '\n...(truncated)'
          : r.result;

      return `[${status}] ${r.action}${errorNote}\n${output}`;
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
