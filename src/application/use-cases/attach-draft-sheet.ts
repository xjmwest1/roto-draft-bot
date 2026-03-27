import type { DraftState } from '../../domain/draft/types.js';
import type { DraftChannel } from '../types.js';
import type { DraftChannelStorePort } from '../ports/draft-channel-store-port.js';
import type { DraftRepositoryPort } from '../ports/draft-repository-port.js';
import type { DraftSnapshotStorePort } from '../ports/draft-snapshot-store-port.js';

export type AttachDraftSheetInput = {
  guildId: string;
  channelId: string;
  sheetId: string;
  sheetUrl: string;
};

export type AttachDraftSheetResult = {
  draftChannel: DraftChannel;
  draftState: DraftState;
};

export class AttachDraftSheetUseCase {
  constructor(
    private channelStore: DraftChannelStorePort,
    private draftRepo: DraftRepositoryPort,
    private snapshotStore: DraftSnapshotStorePort
  ) {}

  async execute(input: AttachDraftSheetInput): Promise<AttachDraftSheetResult> {
    const draftChannel = this.channelStore.attachDraftSheet(
      input.guildId,
      input.channelId,
      input.sheetId,
      input.sheetUrl
    );

    const draftState = await this.draftRepo.getDraftState(draftChannel.sheetId);

    // Avoid announcing historical picks on first attach.
    this.snapshotStore.updateSnapshot(input.channelId, draftState.picks.length, '');

    return { draftChannel, draftState };
  }
}

