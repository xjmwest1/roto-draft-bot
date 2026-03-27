import type { Client } from 'discord.js';
import type { DiscordMemberResolverPort } from '../../application/ports/discord-member-resolver-port.js';

export class DiscordMemberResolver implements DiscordMemberResolverPort {
  constructor(private client: Client) {}

  async resolveDiscordIdByUsername(guildId: string, discordUsername: string): Promise<string | null> {
    const guild = await this.client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return null;

    const members = await guild.members.search({ query: discordUsername, limit: 1 }).catch(() => null);
    const member = members?.first() ?? null;
    return member?.id ?? null;
  }
}

