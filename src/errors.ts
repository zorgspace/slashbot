/**
 * Slashbot Error Classes
 */

export class SlashbotError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true,
  ) {
    super(message);
    this.name = 'SlashbotError';
  }
}

export class ActionError extends SlashbotError {
  constructor(
    message: string,
    public actionType: string,
  ) {
    super(message, 'ACTION_ERROR', true);
    this.name = 'ActionError';
  }
}

export class ApiError extends SlashbotError {
  constructor(
    message: string,
    public statusCode?: number,
  ) {
    super(message, 'API_ERROR', true);
    this.name = 'ApiError';
  }
}

export class ConfigError extends SlashbotError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR', false);
    this.name = 'ConfigError';
  }
}
