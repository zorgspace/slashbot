import type { ActionParserConfig } from '../../core/actions/parser';
import type { Action } from '../../core/actions/types';

export function getWalletParserConfigs(): ActionParserConfig[] {
  return [
    // Wallet-status action
    {
      tags: ['wallet-status'],
      selfClosingTags: ['wallet-status'],
      parse(content): Action[] {
        const actions: Action[] = [];
        const regex = /<wallet-status\s*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          actions.push({ type: 'wallet-status' } as Action);
        }
        return actions;
      },
    },
    // Wallet-send action
    {
      tags: ['wallet-send'],
      selfClosingTags: ['wallet-send'],
      parse(content, { extractAttr }): Action[] {
        const actions: Action[] = [];
        const regex = /<wallet-send\s+[^>]*\/?>/gi;
        let match;
        while ((match = regex.exec(content)) !== null) {
          const fullTag = match[0];
          const token = extractAttr(fullTag, 'token') as 'sol' | 'slashbot';
          const toAddress = extractAttr(fullTag, 'to') || extractAttr(fullTag, 'address');
          const amountStr = extractAttr(fullTag, 'amount');
          if (token && toAddress && amountStr) {
            const amount = parseFloat(amountStr);
            if (!isNaN(amount) && amount > 0) {
              actions.push({
                type: 'wallet-send',
                token,
                toAddress,
                amount,
              } as Action);
            }
          }
        }
        return actions;
      },
    },
  ];
}
