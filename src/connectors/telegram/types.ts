export interface TelegramConfigAction {
  type: 'telegram-config';
  botToken: string;
  chatId?: string;
}
