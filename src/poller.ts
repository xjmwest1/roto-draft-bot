import { Client, TextChannel } from 'discord.js';
import { ConfigStore, DraftChannel } from './config-store.js';
import { GoogleSheetsRepository } from './sheets-repository.js';
import { DraftService, DraftState } from './draft-service.js';

export class DraftPoller {
  private client: Client;
  private configStore: ConfigStore;
  private sheetsRepository: GoogleSheetsRepository;
  private draftService: DraftService;
  private pollingInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(
    client: Client,
    configStore: ConfigStore,
    sheetsRepository: GoogleSheetsRepository,
    draftService: DraftService
  ) {
    this.client = client;
    this.configStore = configStore;
    this.sheetsRepository = sheetsRepository;
    this.draftService = draftService;
  }

  start() {
    if (this.pollingInterval) {
      console.log('⚠️ Poller is already running');
      return;
    }

    console.log('🔄 Starting draft poller (60-second polling)...');
    this.isRunning = true;

    // Run immediately on start
    this.poll().catch((error) => {
      console.error('Error in initial poll:', error);
    });

    // Then run every 60 seconds
    this.pollingInterval = setInterval(() => {
      this.poll().catch((error) => {
        console.error('Error in polling loop:', error);
      });
    }, 60 * 1000); // 60 seconds
  }

  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
    this.isRunning = false;
    console.log('⏹️ Poller stopped');
  }

  private async poll() {
    if (!this.isRunning) return;

    try {
      const draftChannels = this.configStore.getAllDraftChannels();

      for (const draftChannel of draftChannels) {
        await this.pollChannel(draftChannel).catch((error) => {
          console.error(`Error polling channel ${draftChannel.channelId}:`, error);
        });
      }
    } catch (error) {
      console.error('Error in poller main loop:', error);
    }
  }

  private async pollChannel(draftChannel: DraftChannel) {
    // Fetch the guild for Discord ID resolution
    const guild = await this.client.guilds.fetch(draftChannel.guildId).catch(() => null);

    // Get the current draft state
    const currentState = await this.draftService.getDraftState(draftChannel.sheetId, guild || undefined);

    // Get the snapshot for this channel
    const snapshot = this.configStore.getSnapshot(draftChannel.channelId);

    // Determine the previous state based on snapshot
    const previousPickCount = snapshot?.lastSeenPickCount ?? 0;

    // Detect new picks
    const newPicks = currentState.picks.slice(previousPickCount);

    // If there are new picks, announce them
    if (newPicks.length > 0) {
      const channel = await this.client.channels.fetch(draftChannel.channelId).catch(() => null);

      if (channel && 'send' in channel) {
        // Announce each new pick
        for (const pick of newPicks) {
          const cardName = pick.cards[0]; // Get the first (and typically only) card
          const playerName = pick.player;

          // Build announcement
          let announcement = `🎯 **${playerName}** picked **${cardName}**.\n`;

          // Fetch updated state to get the next drafter
          const updatedState = await this.draftService.getDraftState(draftChannel.sheetId, guild || undefined);
          const nextDrafter = updatedState.currentDrafter;

          if (nextDrafter) {
            // Try to find Discord user for pinging
            const mentionStr = nextDrafter.discordId
              ? `<@${nextDrafter.discordId}>`
              : nextDrafter.name;
            announcement += `\nYou're up ${mentionStr}!`;
          }

          // Send announcement
          await (channel as TextChannel).send(announcement);
        }
      } else {
        console.error(`Could not find text channel for announcement: ${draftChannel.channelId}`);
      }

      // Update snapshot with new pick count
      const newPickCount = currentState.picks.length;
      const lastPickKey = newPicks[newPicks.length - 1]?.player || '';
      this.configStore.updateSnapshot(draftChannel.channelId, newPickCount, lastPickKey);

      console.log(`✅ Detected and announced ${newPicks.length} new pick(s) in channel ${draftChannel.channelId}`);
    }
  }
}
