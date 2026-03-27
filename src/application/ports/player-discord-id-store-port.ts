import type { PlayerDiscordId } from '../types.js';

export interface PlayerDiscordIdStorePort {
  savePlayerDiscordId(guildId: string, playerName: string, discordId: string): void;
  getPlayerDiscordId(guildId: string, playerName: string): PlayerDiscordId | null;
}

