/**
 * Wallet Action Handlers
 *
 * Handlers for wallet-related actions:
 * - wallet-status: Check wallet existence and balances
 * - wallet-send: Transfer SOL or SLASHBOT tokens
 */

import type { ActionResult, ActionHandlers } from '../../core/actions/types';
import type { WalletStatusAction, WalletSendAction } from './types';
import { display } from '../../core/ui';

/**
 * Execute a wallet-status action - check wallet and balances
 */
export async function executeWalletStatus(
  action: WalletStatusAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  display.tool('WalletStatus');

  try {
    if (!handlers.onWalletStatus) {
      return {
        action: 'wallet-status',
        success: false,
        result: '',
        error: 'Wallet handler not available',
      };
    }

    const status = await handlers.onWalletStatus();

    if (!status.exists) {
      display.result('No wallet configured');
      return {
        action: 'wallet-status',
        success: true,
        result: 'No wallet configured. Use /wallet create to set up a wallet.',
      };
    }

    const lines: string[] = [];
    lines.push(`Address: ${status.publicKey}`);
    lines.push(`Session: ${status.sessionActive ? 'Active (unlocked)' : 'Inactive (locked)'}`);

    if (status.balances) {
      lines.push(`SOL: ${status.balances.sol}`);
      lines.push(`SLASHBOT: ${status.balances.slashbot}`);
    } else {
      lines.push('Balances: Unable to fetch');
    }

    const result = lines.join('\n');
    display.result(result);

    return {
      action: 'wallet-status',
      success: true,
      result,
    };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    display.error(errorMsg);

    return {
      action: 'wallet-status',
      success: false,
      result: '',
      error: `Wallet status failed: ${errorMsg}`,
    };
  }
}

/**
 * Execute a wallet-send action - transfer tokens
 */
export async function executeWalletSend(
  action: WalletSendAction,
  handlers: ActionHandlers,
): Promise<ActionResult> {
  display.tool('WalletSend', `${action.amount} ${action.token} → ${action.toAddress}`);

  try {
    if (!handlers.onWalletSend) {
      return {
        action: 'wallet-send',
        success: false,
        result: '',
        error: 'Wallet send handler not available',
      };
    }

    const result = await handlers.onWalletSend(action.token, action.toAddress, action.amount);

    if (result.success) {
      const msg = `Sent ${action.amount} ${action.token.toUpperCase()} to ${action.toAddress}\nSignature: ${result.signature}\nExplorer: https://solscan.io/tx/${result.signature}`;
      display.success(`Sent ${action.amount} ${action.token.toUpperCase()}`);
      return {
        action: 'wallet-send',
        success: true,
        result: msg,
      };
    } else {
      display.error(result.error || 'Transfer failed');
      return {
        action: 'wallet-send',
        success: false,
        result: '',
        error: result.error || 'Transfer failed',
      };
    }
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    display.error(errorMsg);

    return {
      action: 'wallet-send',
      success: false,
      result: '',
      error: `Wallet send failed: ${errorMsg}`,
    };
  }
}
