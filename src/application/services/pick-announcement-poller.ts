import type { DraftChannelStorePort } from '../ports/draft-channel-store-port.js';
import type { PickAnnouncement } from '../use-cases/announce-new-picks.js';
import type { AnnounceNewPicksUseCase } from '../use-cases/announce-new-picks.js';

export class PickAnnouncementPollerService {
  constructor(
    private channelStore: DraftChannelStorePort,
    private announceNewPicks: AnnounceNewPicksUseCase
  ) {}

  async poll(): Promise<PickAnnouncement[]> {
    const channels = this.channelStore.getAllDraftChannels();
    const batches = await Promise.allSettled(
      channels.map((draftChannel) => this.announceNewPicks.execute({ draftChannel }))
    );

    const announcements: PickAnnouncement[] = [];
    for (const b of batches) {
      if (b.status === 'fulfilled') {
        announcements.push(...b.value);
      }
    }

    return announcements;
  }
}

