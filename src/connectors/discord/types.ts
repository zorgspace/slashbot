export interface DiscordConfigAction {
  type: 'discord-config';
  botToken: string;
  channelId: string;
  channelIds?: string[];
  ownerId?: string;
}
