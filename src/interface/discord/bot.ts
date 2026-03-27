import { CacheType, Client, GatewayIntentBits, Interaction, REST, Routes, codeBlock } from 'discord.js';
import { AttachDraftSheetUseCase } from '../../application/use-cases/attach-draft-sheet.js';
import { ConfirmPickUseCase } from '../../application/use-cases/confirm-pick.js';
import { GetDraftStatusUseCase } from '../../application/use-cases/get-draft-status.js';
import { PreparePickConfirmationUseCase } from '../../application/use-cases/prepare-pick-confirmation.js';
import { AnnounceNewPicksUseCase } from '../../application/use-cases/announce-new-picks.js';
import { PickAnnouncementPollerService } from '../../application/services/pick-announcement-poller.js';
import { IntervalPoller } from '../../application/services/interval-poller.js';
import { DiscordMemberResolver } from '../../external/discord/discord-member-resolver.js';
import { GoogleSheetsDraftRepository } from '../../external/google-sheets/google-sheets-draft-repository.js';
import { ScryfallCardInfo } from '../../external/scryfall/scryfall-card-info.js';
import { SqliteDraftStore } from '../../external/sqlite/sqlite-draft-store.js';
import { buildCommandModules } from './command-registry.js';
import type { CommandContext } from './command-context.js';
import { InteractionDispatcher } from './interaction-dispatcher.js';

export class DiscordBot {
  private client: Client;
  private poller: IntervalPoller;
  private ctx: CommandContext;
  private dispatcher: InteractionDispatcher;
  private state: 'logging_in' | 'logged_in' | 'logging_out' | 'logged_out' = 'logged_out';

  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
    });

    const draftRepo = new GoogleSheetsDraftRepository();
    const sqliteStore = new SqliteDraftStore();
    const cardInfo = new ScryfallCardInfo();
    const memberResolver = new DiscordMemberResolver(this.client);

    const attachDraftSheet = new AttachDraftSheetUseCase(sqliteStore, draftRepo, sqliteStore);
    const getDraftStatus = new GetDraftStatusUseCase(sqliteStore, draftRepo);
    const preparePickConfirmation = new PreparePickConfirmationUseCase(sqliteStore, draftRepo, cardInfo);
    const confirmPick = new ConfirmPickUseCase(sqliteStore, draftRepo, sqliteStore, sqliteStore);
    const announceNewPicks = new AnnounceNewPicksUseCase(sqliteStore, draftRepo, sqliteStore, sqliteStore);
    const pickAnnouncementPoller = new PickAnnouncementPollerService(sqliteStore, announceNewPicks);

    this.ctx = {
      client: this.client,
      channelStore: sqliteStore,
      snapshotStore: sqliteStore,
      playerDiscordIds: sqliteStore,
      memberResolver,
      cardInfo,
      draftRepo,
      attachDraftSheet,
      getDraftStatus,
      preparePickConfirmation,
      confirmPick,
      announceNewPicks,
      pickAnnouncementPoller,
      queuedPicksStore: sqliteStore,
    };

    this.dispatcher = new InteractionDispatcher(buildCommandModules(), this.ctx);
    this.poller = new IntervalPoller(this.announceNewPicks.bind(this));

    this.client.on('ready', this.init.bind(this));
    this.client.on('interactionCreate', this.setupInteractionHandlers.bind(this));
  }

  private init() {
    console.log(`✅ Bot logged in as ${this.client?.user?.tag}`);
    this.registerSlashCommands();
    this.poller.start();
    this.initializePlayerDiscordIds().catch((error) => {
      console.error('Error initializing player Discord IDs:', error);
    });
  }

  async login() {
    if (this.state === 'logging_in' || this.state === 'logged_in') return;
    this.state = 'logging_in';
    const token = process.env.DISCORD_TOKEN;
    if (!token) throw new Error('DISCORD_TOKEN is required');
    await this.client.login(token);
    this.state = 'logged_in';
  }

  async logout() {
    if (this.state === 'logging_out' || this.state === 'logged_out') return;
    this.state = 'logging_out';
    await this.announceShutdown();
    this.poller.stop();
    (this.ctx.channelStore as any).close?.();
    await this.client.destroy();
    this.state = 'logged_out';
  }

  private async announceShutdown() {
    const draftChannels = this.ctx.channelStore.getAllDraftChannels();
    const announcement = 'My service is restarting, in a minute please reattach the draft spreadsheet using the following command';
    const announcementPromises = draftChannels.map(async (draftChannel) => {
      const channel = await this.client.channels.fetch(draftChannel.channelId).catch(() => null);
      if (!channel?.isSendable()) return;
      const attachCommand = `/draft attach sheet_url:${draftChannel.sheetUrl}`;
      await channel.send(`${announcement}\n${codeBlock(attachCommand)}`);
    });
    return Promise.allSettled(announcementPromises);
  }

  private async registerSlashCommands() {
    const token = process.env.DISCORD_TOKEN;
    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!token || !clientId) {
      throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');
    }

    const rest = new REST({ version: '10' }).setToken(token);
    await rest.put(Routes.applicationCommands(clientId), {
      body: buildCommandModules().map((m) => m.command),
    });
  }

  private async initializePlayerDiscordIds() {
    const draftChannels = this.ctx.channelStore.getAllDraftChannels();
    for (const draftChannel of draftChannels) {
      try {
        const draftState = await this.ctx.draftRepo.getDraftState(draftChannel.sheetId);
        for (const player of draftState.players) {
          const discordId = await this.ctx.memberResolver.resolveDiscordIdByUsername(
            draftChannel.guildId,
            player.discordUsername
          );
          if (discordId) {
            this.ctx.playerDiscordIds.savePlayerDiscordId(draftChannel.guildId, player.name, discordId);
          }
        }
      } catch (error) {
        console.warn(`Error initializing Discord IDs for channel ${draftChannel.channelId}:`, error);
      }
    }
  }

  private async announceNewPicks() {
    const announcements = await this.ctx.pickAnnouncementPoller.poll();
    const byChannel = new Map<string, { channelId: string; message: string }[]>();
    for (const a of announcements) {
      const list = byChannel.get(a.channelId) ?? [];
      list.push(a);
      byChannel.set(a.channelId, list);
    }

    for (const [channelId, msgs] of byChannel.entries()) {
      const channel = await this.client.channels.fetch(channelId).catch(() => null);
      if (!channel?.isSendable()) continue;
      for (const m of msgs) {
        await channel.send(m.message);
      }
    }
  }

  private async setupInteractionHandlers(interaction: Interaction<CacheType>) {
    try {
      await this.dispatcher.dispatch(interaction);
    } catch (error) {
      console.error('Error handling interaction:', error);
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '❌ An error occurred while processing your command.', ephemeral: true }).catch(
          () => null
        );
      }
    }
  }
}

