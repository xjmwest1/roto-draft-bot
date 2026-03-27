import type { DraftPick } from '../../domain/draft/types.js';
import type { DraftChannel } from '../types.js';
import type { DraftChannelStorePort } from '../ports/draft-channel-store-port.js';
import type { DraftRepositoryPort } from '../ports/draft-repository-port.js';
import type { DraftSnapshotStorePort } from '../ports/draft-snapshot-store-port.js';
import type { PlayerDiscordIdStorePort } from '../ports/player-discord-id-store-port.js';

export type PickAnnouncement = {
  channelId: string;
  message: string;
};

export type AnnounceNewPicksInput = {
  draftChannel: DraftChannel;
};

export class AnnounceNewPicksUseCase {
  constructor(
    private channelStore: DraftChannelStorePort,
    private draftRepo: DraftRepositoryPort,
    private snapshotStore: DraftSnapshotStorePort,
    private playerDiscordIds: PlayerDiscordIdStorePort
  ) {}

  async execute(input: AnnounceNewPicksInput): Promise<PickAnnouncement[]> {
    const { draftChannel } = input;

    // Ensure channel is still known (defensive, supports future channelStore implementations).
    const currentChannel = this.channelStore.getDraftChannel(draftChannel.channelId);
    if (!currentChannel) {
      return [];
    }

    const currentState = await this.draftRepo.getDraftState(draftChannel.sheetId);
    const snapshot = this.snapshotStore.getSnapshot(draftChannel.channelId);
    const previousPickCount = snapshot?.lastSeenPickCount ?? 0;
    const newPicks = currentState.picks.slice(previousPickCount);

    if (newPicks.length <= 0) {
      return [];
    }

    const announcements: PickAnnouncement[] = [];
    for (const pick of newPicks) {
      announcements.push({
        channelId: draftChannel.channelId,
        message: await this.formatPickAnnouncement(draftChannel.guildId, pick, draftChannel.sheetId),
      });
    }

    const newPickCount = currentState.picks.length;
    const lastPickKey = newPicks[newPicks.length - 1]?.playerName ?? '';
    this.snapshotStore.updateSnapshot(draftChannel.channelId, newPickCount, lastPickKey);

    return announcements;
  }

  private async formatPickAnnouncement(guildId: string, pick: DraftPick, sheetId: string): Promise<string> {
    const cardName = pick.cardNames[0] ?? 'Unknown';
    const playerName = pick.playerName;

    let announcement = `⛏️ **${playerName}** picked **${cardName}**.\n`;

    const updatedState = await this.draftRepo.getDraftState(sheetId);
    const nextDrafterName = updatedState.currentDrafterName;

    if (nextDrafterName) {
      const nextDrafterDiscordId = this.playerDiscordIds.getPlayerDiscordId(guildId, nextDrafterName)?.discordId;
      const mentionStr = nextDrafterDiscordId ? `<@${nextDrafterDiscordId}>` : nextDrafterName;
      announcement += `\nYou're up ${mentionStr}!`;
    }

    return announcement;
  }
}

