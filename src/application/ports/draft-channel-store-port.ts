import type { DraftChannel } from '../types.js';

export interface DraftChannelStorePort {
  attachDraftSheet(
    guildId: string,
    channelId: string,
    sheetId: string,
    sheetUrl: string
  ): DraftChannel;

  getDraftChannel(channelId: string): DraftChannel | null;
  getAllDraftChannels(): DraftChannel[];
}

