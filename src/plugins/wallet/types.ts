export interface WalletStatusAction {
  type: 'wallet-status';
}

export interface WalletSendAction {
  type: 'wallet-send';
  token: 'sol' | 'slashbot';
  toAddress: string;
  amount: number;
}
