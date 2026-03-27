export interface DiscordMemberResolverPort {
  resolveDiscordIdByUsername(guildId: string, discordUsername: string): Promise<string | null>;
}

