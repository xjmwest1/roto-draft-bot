import type { DraftState } from '../../domain/draft/types.js';
import type { DraftChannelStorePort } from '../ports/draft-channel-store-port.js';
import type { DraftRepositoryPort } from '../ports/draft-repository-port.js';

export type GetDraftStatusInput = {
  channelId: string;
};

export type GetDraftStatusResult =
  | { ok: true; draftState: DraftState }
  | { ok: false; reason: 'NO_DRAFT_ATTACHED' };

export class GetDraftStatusUseCase {
  constructor(private channelStore: DraftChannelStorePort, private draftRepo: DraftRepositoryPort) {}

  async execute(input: GetDraftStatusInput): Promise<GetDraftStatusResult> {
    const draftChannel = this.channelStore.getDraftChannel(input.channelId);
    if (!draftChannel) {
      return { ok: false, reason: 'NO_DRAFT_ATTACHED' };
    }

    const draftState = await this.draftRepo.getDraftState(draftChannel.sheetId);
    return { ok: true, draftState };
  }
}

