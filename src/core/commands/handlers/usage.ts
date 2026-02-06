/**
 * Usage Command Handler
 * Monitor API usage in token mode
 */

import type { CommandHandler, CommandContext } from '../registry';
import { PROXY_CONFIG } from '../../config/constants';
import {
  walletExists,
  isSessionActive,
  getSessionAuthHeaders,
  getPublicKey,
} from '../../services/wallet';

/**
 * Format number with thousands separator
 */
function formatNumber(num: number): string {
  return num.toLocaleString();
}

/**
 * Format tokens with K/M suffix
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * Format cost in USD
 */
function formatUsd(usd: number): string {
  if (usd < 0.01) {
    return `$${usd.toFixed(4)}`;
  }
  return `$${usd.toFixed(2)}`;
}

/**
 * Fetch usage data from proxy with signed authentication
 */
async function fetchUsage(
  type: 'summary' | 'stats' | 'history',
  options: { period?: string; limit?: number } = {}
): Promise<any> {
  const publicKey = getPublicKey();
  if (!publicKey) {
    throw new Error('No wallet configured');
  }

  // Require active session for signed requests
  if (!isSessionActive()) {
    throw new Error('Wallet session not active. Run /mode token to unlock.');
  }

  const proxyUrl = PROXY_CONFIG.BASE_URL;
  const params = new URLSearchParams({ type });

  if (options.period) {
    params.set('period', options.period);
  }
  if (options.limit) {
    params.set('limit', options.limit.toString());
  }

  // Sign the request with wallet private key
  const authHeaders = getSessionAuthHeaders();
  if (!authHeaders) {
    throw new Error('Failed to sign request. Session may have expired.');
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...authHeaders,
  };

  const response = await fetch(`${proxyUrl}/api/usage?${params}`, { headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export const usageHandlers: CommandHandler[] = [
  {
    name: 'usage',
    description: 'Monitor API usage in token mode',
    usage: `/usage - Show usage summary
/usage stats [day|week|month] - Show detailed statistics
/usage history [limit] - Show recent API calls
/usage models - Show usage by model`,
    execute: async (args, context: CommandContext) => {
      // Check prerequisites
      if (!walletExists()) {
        console.log('\nNo wallet configured. Run /wallet create first.\n');
        return false;
      }

      const currentMode = context.grokClient?.getPaymentMode() || context.configManager.getConfig().paymentMode;
      if (currentMode !== 'token') {
        console.log('\nUsage tracking is only available in token mode.');
        console.log('Run /mode token to switch.\n');
        return false;
      }

      const subcommand = args[0]?.toLowerCase();

      try {
        // /usage stats [period]
        if (subcommand === 'stats') {
          const period = args[1]?.toLowerCase() || 'month';
          if (!['day', 'week', 'month', 'all'].includes(period)) {
            console.log('\nInvalid period. Use: day, week, month, or all\n');
            return false;
          }

          console.log(`\nFetching ${period} statistics...\n`);
          const data = await fetchUsage('stats', { period });

          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(`Usage Statistics (${period})`);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

          console.log('Requests');
          console.log(`  Total:      ${formatNumber(data.totalRequests)}`);
          console.log(`  Successful: ${formatNumber(data.successfulRequests)}`);
          console.log(`  Failed:     ${formatNumber(data.failedRequests)}`);

          console.log('\nTokens');
          console.log(`  Input:     ${formatTokens(data.totalInputTokens)}`);
          console.log(`  Output:    ${formatTokens(data.totalOutputTokens)}`);
          console.log(`  Total:     ${formatTokens(data.totalTokens)}`);
          if (data.totalCachedTokens > 0) {
            console.log(`  Cached:    ${formatTokens(data.totalCachedTokens)}`);
          }
          if (data.totalReasoningTokens > 0) {
            console.log(`  Reasoning: ${formatTokens(data.totalReasoningTokens)}`);
          }

          console.log('\nCost');
          console.log(`  USD:     ${formatUsd(data.totalCostUsd)}`);
          console.log(`  Credits: ${formatNumber(data.totalCreditsSpent)}`);

          console.log('\nAverages (per request)');
          console.log(`  Input:      ${formatTokens(data.avgInputTokens)} tokens`);
          console.log(`  Output:     ${formatTokens(data.avgOutputTokens)} tokens`);
          console.log(`  Cost:       ${data.avgCostCredits.toFixed(2)} credits`);
          console.log(`  Latency:    ${formatNumber(data.avgProcessingTimeMs)}ms`);

          if (data.byModel && Object.keys(data.byModel).length > 0) {
            console.log('\nBy Model');
            for (const [model, stats] of Object.entries(data.byModel) as [string, any][]) {
              console.log(`  ${model}`);
              console.log(`    Requests: ${formatNumber(stats.requests)}`);
              console.log(`    Tokens:   ${formatTokens(stats.inputTokens + stats.outputTokens)}`);
              console.log(`    Credits:  ${formatNumber(stats.costCredits)}`);
            }
          }

          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        }

        // /usage history [limit]
        if (subcommand === 'history') {
          const limit = parseInt(args[1] || '10', 10);
          if (isNaN(limit) || limit < 1 || limit > 50) {
            console.log('\nLimit must be between 1 and 50.\n');
            return false;
          }

          console.log(`\nFetching last ${limit} API calls...\n`);
          const data = await fetchUsage('history', { limit });

          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('Recent API Calls');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

          if (data.records.length === 0) {
            console.log('No usage history found.\n');
          } else {
            for (const record of data.records) {
              const time = new Date(record.timestamp).toLocaleString();
              const status = record.success ? '✓' : '✗';
              const tokens = `${formatTokens(record.tokens.input)}→${formatTokens(record.tokens.output)}`;
              console.log(`${status} ${time}`);
              console.log(`  Model:   ${record.model}`);
              console.log(`  Tokens:  ${tokens} (${formatTokens(record.tokens.total)} total)`);
              console.log(`  Cost:    ${record.cost.credits} credits (${formatUsd(record.cost.usd)})`);
              console.log(`  Latency: ${record.processingTimeMs}ms`);
              console.log('');
            }
          }

          if (data.pagination) {
            console.log(`Showing ${data.records.length} of ${data.pagination.total} records`);
          }

          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        }

        // /usage models - Show breakdown by model
        if (subcommand === 'models') {
          console.log('\nFetching model breakdown...\n');
          const data = await fetchUsage('stats', { period: 'month' });

          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log('Usage by Model (Last 30 Days)');
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

          if (!data.byModel || Object.keys(data.byModel).length === 0) {
            console.log('No model usage data found.\n');
          } else {
            // Sort by credits spent
            const models = Object.entries(data.byModel)
              .sort((a: [string, any], b: [string, any]) => b[1].costCredits - a[1].costCredits);

            console.log('Model                          │ Requests │  Tokens  │ Credits');
            console.log('───────────────────────────────┼──────────┼──────────┼────────');

            for (const [model, stats] of models as [string, any][]) {
              const name = model.padEnd(30);
              const reqs = formatNumber(stats.requests).padStart(8);
              const tokens = formatTokens(stats.inputTokens + stats.outputTokens).padStart(8);
              const credits = formatNumber(stats.costCredits).padStart(7);
              console.log(`${name} │ ${reqs} │ ${tokens} │ ${credits}`);
            }

            console.log('───────────────────────────────┼──────────┼──────────┼────────');
            const totalReqs = formatNumber(data.totalRequests).padStart(8);
            const totalTokens = formatTokens(data.totalTokens).padStart(8);
            const totalCredits = formatNumber(data.totalCreditsSpent).padStart(7);
            console.log(`${'Total'.padEnd(30)} │ ${totalReqs} │ ${totalTokens} │ ${totalCredits}`);
          }

          console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
          return true;
        }

        // Default: /usage - Show summary
        console.log('\nFetching usage summary...\n');
        const data = await fetchUsage('summary');

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Usage Summary');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        console.log(`Wallet: ${data.walletAddress}\n`);

        console.log('           │ Requests │   Tokens   │ Credits');
        console.log('───────────┼──────────┼────────────┼────────');

        const formatRow = (label: string, stats: any) => {
          const lbl = label.padEnd(10);
          const reqs = formatNumber(stats.requests).padStart(8);
          const tokens = formatTokens(stats.tokens).padStart(10);
          const credits = formatNumber(stats.credits).padStart(7);
          return `${lbl} │ ${reqs} │ ${tokens} │ ${credits}`;
        };

        console.log(formatRow('Today', data.today));
        console.log(formatRow('This Week', data.thisWeek));
        console.log(formatRow('This Month', data.thisMonth));

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Commands:');
        console.log('  /usage stats [day|week|month]  - Detailed statistics');
        console.log('  /usage history [limit]         - Recent API calls');
        console.log('  /usage models                  - Breakdown by model');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        return true;
      } catch (error) {
        console.error(`\nFailed to fetch usage data: ${error instanceof Error ? error.message : error}\n`);
        return false;
      }
    },
  },
];
