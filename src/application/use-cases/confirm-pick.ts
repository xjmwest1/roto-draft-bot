import { checkQueue } from '../../domain/draft/check-queue.js';
import type { DraftChannelStorePort } from '../ports/draft-channel-store-port.js';
import { DraftQueuedPicksStorePort } from '../ports/draft-queued-picks-store-port.js';
import type { DraftRepositoryPort } from '../ports/draft-repository-port.js';
import type { PlayerDiscordIdStorePort } from '../ports/player-discord-id-store-port.js';

export type ConfirmPickInput = {
  channelId: string;
  actorDiscordId: string;
  cardName: string;
  isQueuePick?: boolean;
};

export type ConfirmPickResult =
  | { ok: true; pickedCardName: string; actorPlayerName: string; nextDrafterName?: string; nextCardName?: string; wasQueuePick?: boolean }
  | { ok: false; reason: 'NO_DRAFT_ATTACHED' | 'CARD_NOT_AVAILABLE' | 'UNKNOWN_CURRENT_DRAFTER' };

export class ConfirmPickUseCase {
  constructor(
    private channelStore: DraftChannelStorePort,
    private draftRepo: DraftRepositoryPort,
    private playerDiscordIds: PlayerDiscordIdStorePort,
    private queuedPicksStore: DraftQueuedPicksStorePort
  ) {}

  async execute(input: ConfirmPickInput): Promise<ConfirmPickResult> {
    const draftChannel = this.channelStore.getDraftChannel(input.channelId);
    if (!draftChannel) {
      return { ok: false, reason: 'NO_DRAFT_ATTACHED' };
    }

    const draftState = await this.draftRepo.getDraftState(draftChannel.sheetId);

    const currentDrafterName = draftState.currentDrafterName;
    if (!currentDrafterName) {
      return { ok: false, reason: 'UNKNOWN_CURRENT_DRAFTER' };
    }

    const card = draftState.availableCards.find(
      (c) => c.name.toLowerCase() === input.cardName.toLowerCase()
    );
    if (!card) {
      return { ok: false, reason: 'CARD_NOT_AVAILABLE' };
    }

    const currentDrafterDiscordId =
    this.playerDiscordIds.getPlayerDiscordId(draftChannel.guildId, currentDrafterName)?.discordId ?? null;

    if (!currentDrafterDiscordId || currentDrafterDiscordId !== input.actorDiscordId) {
      this.queuedPicksStore.queuePick(draftChannel.channelId, currentDrafterName, card.name);
      return { ok: true, pickedCardName: card.name, actorPlayerName: currentDrafterName, wasQueuePick: true };
    }

    await this.draftRepo.writeNextPick(draftChannel.sheetId, card.name);
    
    this.queuedPicksStore.clearQueuedPick(draftChannel.channelId, currentDrafterName);

    const queueResult = checkQueue(draftState, this.queuedPicksStore.getQueuedPicks(draftChannel.channelId));
    if (queueResult.hasQueuedPick) {
      return { 
        ok: true, 
        pickedCardName: card.name, 
        actorPlayerName: currentDrafterName, 
        wasQueuePick: input.isQueuePick,
        nextDrafterName: queueResult.nextDrafterName, 
        nextCardName: queueResult.nextCardName
      };
    }

    return { ok: true, pickedCardName: card.name, actorPlayerName: currentDrafterName };
  }
}

