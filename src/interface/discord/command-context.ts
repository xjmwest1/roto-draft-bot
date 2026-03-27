import type { Client } from 'discord.js';
import type { DraftChannelStorePort } from '../../application/ports/draft-channel-store-port.js';
import type { DraftSnapshotStorePort } from '../../application/ports/draft-snapshot-store-port.js';
import type { PlayerDiscordIdStorePort } from '../../application/ports/player-discord-id-store-port.js';
import type { DiscordMemberResolverPort } from '../../application/ports/discord-member-resolver-port.js';
import type { CardInfoPort } from '../../application/ports/card-info-port.js';
import type { DraftRepositoryPort } from '../../application/ports/draft-repository-port.js';
import type { AttachDraftSheetUseCase } from '../../application/use-cases/attach-draft-sheet.js';
import type { GetDraftStatusUseCase } from '../../application/use-cases/get-draft-status.js';
import type { PreparePickConfirmationUseCase } from '../../application/use-cases/prepare-pick-confirmation.js';
import type { ConfirmPickUseCase } from '../../application/use-cases/confirm-pick.js';
import type { AnnounceNewPicksUseCase } from '../../application/use-cases/announce-new-picks.js';
import type { PickAnnouncementPollerService } from '../../application/services/pick-announcement-poller.js';
import { DraftQueuedPicksStorePort } from '../../application/ports/draft-queued-picks-store-port.js';

export type CommandContext = {
  client: Client;
  channelStore: DraftChannelStorePort;
  snapshotStore: DraftSnapshotStorePort;
  playerDiscordIds: PlayerDiscordIdStorePort;
  memberResolver: DiscordMemberResolverPort;
  cardInfo: CardInfoPort;
  draftRepo: DraftRepositoryPort;
  attachDraftSheet: AttachDraftSheetUseCase;
  getDraftStatus: GetDraftStatusUseCase;
  preparePickConfirmation: PreparePickConfirmationUseCase;
  confirmPick: ConfirmPickUseCase;
  announceNewPicks: AnnounceNewPicksUseCase;
  pickAnnouncementPoller: PickAnnouncementPollerService;
  queuedPicksStore: DraftQueuedPicksStorePort
};

