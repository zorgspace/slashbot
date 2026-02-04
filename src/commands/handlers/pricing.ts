/**
 * Pricing Command Handlers
 * Display dynamic pricing information for API calls
 */

import type { CommandHandler, CommandContext } from '../registry';
import { getPricingService, XAI_MODEL_PRICING } from '../../services/pricing';

/**
 * Format number with appropriate precision
 */
function formatNumber(num: number, decimals = 6): string {
  if (num === 0) return '0';
  if (num < 0.000001) return num.toExponential(2);
  if (num < 1) return num.toFixed(decimals);
  if (num < 1000) return num.toFixed(2);
  return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export const pricingHandlers: CommandHandler[] = [
  {
    name: 'pricing',
    description: 'Show current API pricing and exchange rates',
    usage: '/pricing [model] - Show pricing for a model\n/pricing models - List all models',
    execute: async (args, context: CommandContext) => {
      const pricingService = getPricingService();

      // Check for 'models' subcommand
      if (args[0] === 'models') {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Available Models (xAI base prices x 5)');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        console.log('Model                         | Input/1M | Output/1M');
        console.log('------------------------------|----------|----------');

        for (const model of XAI_MODEL_PRICING) {
          const inputPrice = (model.inputPricePerMillion * 5).toFixed(2);
          const outputPrice = (model.outputPricePerMillion * 5).toFixed(2);
          const name = model.model.padEnd(29);
          console.log(`${name} | $${inputPrice.padStart(6)} | $${outputPrice.padStart(7)}`);
        }

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Prices shown in USD. Run /pricing <model> for full details.\n');

        return true;
      }

      const currentModel = context.grokClient?.getCurrentModel() || 'grok-4-1-fast-reasoning';
      const model = args[0] || currentModel;

      try {
        console.log('\nFetching current exchange rates...\n');

        const info = await pricingService.getPricingInfo(model);

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('SLASHBOT API Pricing');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        console.log(`Exchange Rates (updated ${new Date(info.exchangeRates.updatedAt).toLocaleTimeString()})`);
        console.log(`   SOL/USD:      $${formatNumber(info.exchangeRates.solUsd, 2)}`);
        console.log(`   SLASHBOT/SOL: ${formatNumber(info.exchangeRates.slashbotSol, 9)} SOL\n`);

        console.log(`Model: ${info.model}`);
        console.log(`   Multiplier: ${info.multiplier}x xAI base price\n`);

        console.log('Input Token Pricing (per 1M tokens):');
        console.log(`   USD:      $${formatNumber(info.inputPricePerMillion.usd)}`);
        console.log(`   SOL:      ${formatNumber(info.inputPricePerMillion.sol, 9)}`);
        console.log(`   SLASHBOT: ${formatNumber(info.inputPricePerMillion.slashbot)}\n`);

        console.log('Output Token Pricing (per 1M tokens):');
        console.log(`   USD:      $${formatNumber(info.outputPricePerMillion.usd)}`);
        console.log(`   SOL:      ${formatNumber(info.outputPricePerMillion.sol, 9)}`);
        console.log(`   SLASHBOT: ${formatNumber(info.outputPricePerMillion.slashbot)}\n`);

        // Example cost calculation
        const exampleCost = await pricingService.calculateCost(model, 1000, 500);
        console.log('Example (1000 in / 500 out tokens):');
        console.log(`   USD:      $${formatNumber(exampleCost.usd)}`);
        console.log(`   SOL:      ${formatNumber(exampleCost.sol, 9)}`);
        console.log(`   SLASHBOT: ${formatNumber(exampleCost.slashbot)}\n`);

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('Usage: /pricing [model]');
        console.log('       /pricing models - List all models\n');

        return true;
      } catch (error) {
        console.error('Failed to fetch pricing:', error);
        return false;
      }
    },
  },
];
