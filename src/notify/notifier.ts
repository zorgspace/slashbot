/**
 * Notification Connectors for Telegram and WhatsApp
 */

import { c } from '../ui/colors';

export interface NotificationConfig {
  telegram?: {
    botToken: string;
    chatId: string;
  };
  whatsapp?: {
    webhookUrl: string;
  };
}

export interface NotificationResult {
  success: boolean;
  service: string;
  error?: string;
}

export class Notifier {
  private config: NotificationConfig = {};

  configureTelegram(botToken: string, chatId: string): void {
    this.config.telegram = { botToken, chatId };
  }

  configureWhatsApp(webhookUrl: string): void {
    this.config.whatsapp = { webhookUrl };
  }

  getStatus(): { telegram: boolean; whatsapp: boolean } {
    return {
      telegram: !!this.config.telegram,
      whatsapp: !!this.config.whatsapp,
    };
  }

  async sendTelegram(message: string): Promise<NotificationResult> {
    if (!this.config.telegram) {
      return {
        success: false,
        service: 'telegram',
        error: 'Telegram not configured. Use /notify telegram <token> <chat_id>',
      };
    }

    const { botToken, chatId } = this.config.telegram;
    const url = `https://api.telegram.org/bot${botToken}/sendMessage`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🤖 Slashbot\n\n${message}`,
          parse_mode: 'HTML',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Telegram API error: ${error}`);
      }

      return {
        success: true,
        service: 'telegram',
      };
    } catch (error) {
      return {
        success: false,
        service: 'telegram',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async sendWhatsApp(message: string): Promise<NotificationResult> {
    if (!this.config.whatsapp) {
      return {
        success: false,
        service: 'whatsapp',
        error: 'WhatsApp not configured. Use /notify whatsapp <webhook_url>',
      };
    }

    const { webhookUrl } = this.config.whatsapp;

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'slashbot',
          message: message,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`WhatsApp webhook error: ${response.status}`);
      }

      return {
        success: true,
        service: 'whatsapp',
      };
    } catch (error) {
      return {
        success: false,
        service: 'whatsapp',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async sendAll(message: string): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];

    if (this.config.telegram) {
      results.push(await this.sendTelegram(message));
    }

    if (this.config.whatsapp) {
      results.push(await this.sendWhatsApp(message));
    }

    if (results.length === 0) {
      console.log(c.warning('No notification services configured'));
    }

    return results;
  }

  async notify(message: string, service?: 'telegram' | 'whatsapp' | 'all'): Promise<void> {
    let results: NotificationResult[];

    switch (service) {
      case 'telegram':
        results = [await this.sendTelegram(message)];
        break;
      case 'whatsapp':
        results = [await this.sendWhatsApp(message)];
        break;
      case 'all':
      default:
        results = await this.sendAll(message);
    }

    for (const result of results) {
      if (result.success) {
        console.log(c.success(`Notification sent via ${result.service}`));
      } else {
        console.log(c.error(`Échec ${result.service}: ${result.error}`));
      }
    }
  }
}

// Factory function
export function createNotifier(): Notifier {
  return new Notifier();
}
