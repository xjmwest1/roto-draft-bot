import type { DraftState } from '../../domain/draft/types.js';
import type { DraftChannelStorePort } from '../ports/draft-channel-store-port.js';
import type { DraftRepositoryPort } from '../ports/draft-repository-port.js';
import type { CardInfoPort } from '../ports/card-info-port.js';

export type PreparePickConfirmationInput = {
  channelId: string;
  cardName: string;
};

export type PreparePickConfirmationResult =
  | {
      ok: true;
      draftState: DraftState;
      resolvedCardName: string;
      cardImageUrl?: string;
    }
  | { ok: false; reason: 'NO_DRAFT_ATTACHED' | 'CARD_NOT_AVAILABLE' };

export class PreparePickConfirmationUseCase {
  constructor(
    private channelStore: DraftChannelStorePort,
    private draftRepo: DraftRepositoryPort,
    private cardInfo: CardInfoPort
  ) {}

  async execute(input: PreparePickConfirmationInput): Promise<PreparePickConfirmationResult> {
    const draftChannel = this.channelStore.getDraftChannel(input.channelId);
    if (!draftChannel) {
      return { ok: false, reason: 'NO_DRAFT_ATTACHED' };
    }

    const draftState = await this.draftRepo.getDraftState(draftChannel.sheetId);
    const card = draftState.availableCards.find(
      (c) => c.name.toLowerCase() === input.cardName.toLowerCase()
    );
    if (!card) {
      return { ok: false, reason: 'CARD_NOT_AVAILABLE' };
    }

    const cardInfo = await this.cardInfo.getCardImage(card.name);

    return {
      ok: true,
      draftState,
      resolvedCardName: card.name,
      cardImageUrl: cardInfo.imageUrl,
    };
  }
}

