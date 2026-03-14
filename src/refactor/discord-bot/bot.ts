import { ActionRowBuilder, AutocompleteInteraction, BaseInteraction, ButtonBuilder, ButtonInteraction, ButtonStyle, CacheType, ChatInputCommandInteraction, Client, EmbedBuilder, GatewayIntentBits, Guild, Interaction, REST, Routes, SlashCommandBuilder } from 'discord.js'
import { Poller } from '../poller/index.js'
import { DraftSnapshotStore } from '../draft-snapshot-store/index.js'
import { GoogleSheetsRepository } from '../google-sheet/index.js'
import { DraftService } from '../draft-service/index.js'
import { DraftChannel } from '../draft-snapshot-store/types.js'
import { filterCards, queryScryfallCard } from './autocomplete.js'
import { Player } from '../draft-service/types.js'

class DiscordBot {
  private client: Client
  private poller: Poller
  private sheetsRepository: GoogleSheetsRepository
  private snapshotStore: DraftSnapshotStore
  private draftService: DraftService

  constructor() {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
    })
    this.poller = new Poller(this.announceNewPicks.bind(this))
    this.sheetsRepository = new GoogleSheetsRepository()
    this.snapshotStore = new DraftSnapshotStore()
    this.draftService = new DraftService(this.sheetsRepository)

    this.client.on('ready', this.init.bind(this))
    this.client.on('interactionCreate', this.setupInteractionHandlers.bind(this))
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
    const TOKEN = process.env.DISCORD_TOKEN
    
    if (!TOKEN) {
      throw new Error('DISCORD_TOKEN is required')
    }

    await this.client.login(TOKEN)
  }

  async logout() {
    this.poller.stop()
    
    this.snapshotStore.close()
    await this.client.destroy()
  }

  // TODO refactor
  private async registerSlashCommands() {
    const TOKEN = process.env.DISCORD_TOKEN;
    const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
    
    if (!TOKEN || !CLIENT_ID) {
      throw new Error('DISCORD_TOKEN and DISCORD_CLIENT_ID are required');
    }

    const commands = [
      new SlashCommandBuilder()
        .setName('draft')
        .setDescription('Manage draft setup')
        .addSubcommand((subcommand) =>
          subcommand
            .setName('attach')
            .setDescription('Attach a Google Sheet to this channel for draft tracking')
            .addStringOption((option) =>
              option
                .setName('sheet_url')
                .setDescription('The URL of the draft Google Sheet')
                .setRequired(true)
            )
        )
        .addSubcommand((subcommand) => subcommand.setName('status').setDescription('Show the current draft status')),

      new SlashCommandBuilder()
        .setName('pick')
        .setDescription('Make a draft pick')
        .addStringOption((option) =>
          option
            .setName('card')
            .setDescription('The card to pick')
            .setRequired(true)
            .setAutocomplete(true)
        ),
    ];

    const rest = new REST({ version: '10' }).setToken(TOKEN);

    try {
      console.log('🔄 Registering slash commands...');
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      console.log('✅ Slash commands registered');
    } catch (error) {
      console.error('Failed to register slash commands:', error);
    }
  }

  // TODO refactor
  private async initializePlayerDiscordIds() {
    try {
      const draftChannels = this.snapshotStore.getAllDraftChannels();
      
      console.log(`🔍 Initializing player Discord IDs for ${draftChannels.length} draft channel(s)...`);

      for (const draftChannel of draftChannels) {
        try {
          // Fetch the guild
          const guild = await this.client.guilds.fetch(draftChannel.guildId);
          if (!guild) {
            console.warn(`⚠️ Could not find guild ${draftChannel.guildId} for channel ${draftChannel.channelId}`);
            continue;
          }

          const draftState = await this.draftService.getDraftState(draftChannel)
          if (!draftState) {
            console.warn(`⚠️ Could not find draft state for ${draftChannel.channelId}`)
            continue
          }

          // Resolve Discord IDs
          await this.resolvePlayerDiscordIds(draftState.players, guild);
          console.log(`✅ Resolved Discord IDs for draft channel ${draftChannel.channelId}`);
        } catch (error) {
          console.warn(`⚠️ Error initializing Discord IDs for channel ${draftChannel.channelId}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in initializePlayerDiscordIds:', error);
    }
  }

  // TODO refactor
  private async resolvePlayerDiscordIds(players: Player[], guild: Guild) {
    for (const player of players) {
      try {
        // Try to find member by username
        const members = await guild.members.search({ query: player.discordUsername, limit: 1 });
        if (members && members.size > 0) {
          const member = members.first();
          if (member) {
            this.snapshotStore.savePlayerDiscordId(guild.id, player.name, member.id);
            console.log(`✅ Resolved ${player.name} (${player.discordUsername}) to Discord ID ${member.id}`);
          }
        } else {
          console.warn(`⚠️ Could not find Discord user for ${player.name} (${player.discordUsername})`);
        }
      } catch (error) {
        console.warn(`Error resolving ${player.name} (${player.discordUsername}):`, error);
      }
    }
  }

  private async announceNewPicks() {
    try {
      const announcePicksPromises = this.snapshotStore.getAllDraftChannels().map((draftChannel) => 
        this.announceNewPicksForChannel(draftChannel).catch((error) => {
          console.error(`Error polling channel ${draftChannel.channelId}:`, error);
        })
      )
      await Promise.allSettled(announcePicksPromises)
    } catch (error) {
      console.error('Error in poller main loop:', error);
    }
  }

  private async announceNewPicksForChannel(draftChannel: DraftChannel) {
    const { channelId, guildId } = draftChannel
    
    const currentState = await this.draftService.getDraftState(draftChannel)
    const snapshot = this.snapshotStore.getSnapshot(channelId)
    const previousPickCount = snapshot?.lastSeenPickCount ?? 0
    const newPicks = currentState?.picks.slice(previousPickCount) ?? []

    if (newPicks.length <= 0) {
      return
    }

    const channel = await this.client.channels.fetch(channelId).catch(() => null);
    
    if(!channel?.isSendable()) {
      return
    }

    for (const pick of newPicks) {
      const cardName = pick.cards[0];
      const playerName = pick.player;

      let announcement = `⛏️ **${playerName}** picked **${cardName}**.\n`;

      const updatedState = await this.draftService.getDraftState(draftChannel);
      const nextDrafter = updatedState?.currentDrafter;
      

      if (nextDrafter) {
        const nextDrafterDiscordId = await this.snapshotStore.getPlayerDiscordId(guildId, nextDrafter.name)
        const mentionStr = nextDrafterDiscordId
          ? `<@${nextDrafterDiscordId.discordId}>`
          : nextDrafter.name;
        announcement += `\nYou're up ${mentionStr}!`;
      }

      await channel.send(announcement);
    }

    const newPickCount = currentState?.picks.length ?? 0;
    const lastPickKey = newPicks[newPicks.length - 1]?.player || '';
    this.snapshotStore.updateSnapshot(draftChannel.channelId, newPickCount, lastPickKey);

    console.log(`✅ Detected and announced ${newPicks.length} new pick(s) in channel ${draftChannel.channelId}`);
  }

  private async setupInteractionHandlers(interaction: Interaction<CacheType>) {
    if (interaction.isChatInputCommand()) {
        try {
          if (interaction.commandName === 'draft') {
            await this.handleDraftCommand(interaction);
          } else if (interaction.commandName === 'pick') {
            await this.handlePickCommand(interaction);
          }
        } catch (error) {
          console.error('Error handling interaction:', error);
          await interaction.reply({
            content: '❌ An error occurred while processing your command.',
            ephemeral: true,
          });
        }
      } else if (interaction.isAutocomplete()) {
        try {
          await this.handleAutocomplete(interaction);
        } catch (error) {
          console.error('Error handling autocomplete:', error);
        }
      } else if (interaction.isButton()) {
        try {
          if (interaction.customId.startsWith('confirm_pick_')) {
            await this.handlePickConfirmButton(interaction);
          } else if (interaction.customId === 'cancel_pick') {
            // await this.handleCancelPickButton(interaction);
          }
        } catch (error) {
          console.error('Error handling button interaction:', error);
          await interaction.reply({
            content: '❌ An error occurred processing your pick.',
            ephemeral: true,
          });
        }
      }
  }

  private async handlePickCommand(interaction: ChatInputCommandInteraction) {
    const cardName = interaction.options.getString('card', true);
    const channelId = interaction.channelId;

    const draftChannel = this.snapshotStore.getDraftChannel(channelId);
    if (!draftChannel) {
      return interaction.reply({
        content: '❌ No draft sheet is attached to this channel. Use `/draft attach` to get started.',
        ephemeral: true,
      });
    }

    try {
      const draftState = await this.draftService!.getDraftState(draftChannel);

      // Find the card
      const card = draftState?.availableCards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
      if (!card) {
        return interaction.reply({
          content: '❌ Card not found in available cards.',
          ephemeral: true,
        });
      }

      // Query Scryfall for card details
      const scryfallCard = await queryScryfallCard(card.name);
      
      // Build embed with card image
      const embed = new EmbedBuilder()
        .setTitle(`Pick: ${card.name}`)
        .setColor('#0099ff')
        .setImage(scryfallCard.image_uris?.normal || '')

      const confirmBtn = new ButtonBuilder()
        .setCustomId(`confirm_pick_${channelId}_${card.name}`)
        .setLabel('Confirm Pick')
        .setStyle(ButtonStyle.Success);

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn);

      await interaction.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true,
      });
    } catch (error) {
      console.error('Error handling pick command:', error);
      if (!interaction.replied && !interaction.deferred) {
        return interaction.reply({
          content: '❌ Failed to process pick. Please try again.',
          ephemeral: true,
        }).catch(console.error);
      }
    }
  }

  private async handlePickConfirmButton(interaction: BaseInteraction<CacheType>) {
    if (!interaction.isButton()) return;

    const customId = interaction.customId;
    const match = customId.match(/^confirm_pick_(\d+)_(.+)$/);
    
    if (!match) {
      return interaction.reply({
        content: '❌ Invalid confirmation data.',
        ephemeral: true,
      });
    }

    const channelId = match[1];
    const cardName = match[2];
    const username = interaction.user.username;

    const draftChannel = this.snapshotStore.getDraftChannel(channelId);
    if (!draftChannel) {
      return interaction.reply({
        content: '❌ Draft configuration not found.',
        ephemeral: true,
      });
    }

    try {
      // Defer the reply IMMEDIATELY to prevent "already acknowledged" errors
      await interaction.deferReply({
        ephemeral: true,
      });
      
      // Fetch guild for Discord ID resolution
      const guild = await this.client.guilds.fetch(draftChannel.guildId).catch(() => null);

      // Re-read sheet to ensure latest state
      const draftState = await this.draftService!.getDraftState(draftChannel);

      // Validate the pick
      const currentDrafter = draftState?.currentDrafter;
      const card = draftState?.availableCards.find(c => c.name === cardName);

      if (!currentDrafter) {
        return interaction.editReply({
          content: '❌ Could not determine current drafter.',
        });
      }

      if (!card) {
        return interaction.editReply({
          content: '❌ Card is no longer available.',
        });
      }

      const userDrafter = draftState.players.find(async (player) => player.discordUsername === username)

      if (!userDrafter || userDrafter.discordUsername !== currentDrafter?.discordUsername) {
        return interaction.editReply({
          content: `❌ It is not your turn. ${currentDrafter.name} is up.`,
        });
      }

      // Write pick to sheet
      await this.draftService.makePick(draftChannel, cardName);

      // Acknowledge the pick
      await interaction.editReply({
        content: `✅ Pick confirmed: **${cardName}** by ${userDrafter.name}`,
      });
    } catch (error) {
      console.error('Error confirming pick:', error);
      return interaction.editReply({
        content: `❌ Failed to write pick to sheet: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }).catch(() => {
        // If deferReply wasn't called, this will fail - try regular reply as fallback
        return interaction.reply({
          content: `❌ Failed to write pick to sheet: ${error instanceof Error ? error.message : 'Unknown error'}`,
          ephemeral: true,
        }).catch(console.error);
      });
    }
  }

  private async handleDraftCommand(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'attach') {
      await this.handleDraftAttach(interaction);
    } else if (subcommand === 'status') {
      await this.handleDraftStatus(interaction);
    }
  }

    private async handleDraftAttach(interaction: ChatInputCommandInteraction) {
      const sheetUrl = interaction.options.getString('sheet_url', true);
  
      // Extract sheet ID from URL
      const sheetIdMatch = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (!sheetIdMatch) {
        return interaction.reply({
          content: '❌ Invalid Google Sheets URL. Please provide a full sheet URL.',
          ephemeral: true,
        });
      }
  
      const sheetId = sheetIdMatch[1];
  
      try {
        // Store the mapping
        const guildId = interaction.guildId || 'unknown';
        const channelId = interaction.channelId;
  
        const draftChannel = this.snapshotStore.attachDraftSheet(guildId, channelId, sheetId, sheetUrl);
        const draftState = await this.draftService.getDraftState(draftChannel)

        if (!draftState) {
          return
        }
  
        // Resolve Discord usernames to IDs
        try {
          const guild = await this.client.guilds.fetch(guildId);
          if (guild) {
            await this.resolvePlayerDiscordIds(draftState?.players, guild);
          }
        } catch (error) {
          console.warn('Could not resolve Discord usernames:', error);
        }
  
        // Initialize snapshot with current pick count to avoid announcing existing picks
        const initialPickCount = draftState.picks.length
        this.snapshotStore.updateSnapshot(channelId, initialPickCount, '');
  
        const embed = new EmbedBuilder()
          .setColor('#00ff00')
          .setTitle('✅ Draft Sheet Attached')
          .addFields([
            { name: 'Players', value: draftState.players.map((p) => p.name).join(', ') || 'None' },
            { name: 'Completed picks', value: `${draftState.picks.length}/${draftState.availableCards.length + draftState.picks.length}` },
            { name: 'Next pick', value: draftState.currentDrafter?.name ?? 'Unknown' },
          ]);
  
        return interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      } catch (error) {
        console.error('Error attaching draft sheet:', error);
        return interaction.reply({
          content: '❌ Failed to access the sheet. Please check the URL and try again.',
          ephemeral: true,
        });
      }
    }
  
    private async handleDraftStatus(interaction: ChatInputCommandInteraction) {
      const channelId = interaction.channelId;
      const draftChannel = this.snapshotStore.getDraftChannel(channelId);
  
      if (!draftChannel) {
        return interaction.reply({
          content: '❌ No draft sheet is attached to this channel. Use `/draft attach` to get started.',
          ephemeral: true,
        });
      }
  
      try {
        const draftState = await this.draftService!.getDraftState(draftChannel);

        if (!draftState) {
          return
        }

        const jsonState = {
          ...draftState,
          availableCards: undefined,
        }
  
        const embed = new EmbedBuilder()
          .setColor('#0099ff')
          .setTitle('📊 Draft Status')
          .addFields([
            { name: 'Players', value: draftState.players.map((p) => p.name).join(', ') || 'None' },
            { name: 'Picks', value: `${draftState.picks.length}/${draftState.availableCards.length + draftState.picks.length}` },
            { name: 'Next pick', value: draftState.currentDrafter?.name ?? 'Unknown' },
          ]);
  
        return interaction.reply({
          embeds: [embed],
          ephemeral: true,
        });
      } catch (error) {
        console.error('Error fetching draft status:', error);
        return interaction.reply({
          content: '❌ Failed to fetch draft status. Please try again.',
          ephemeral: true,
        });
      }
    }

  private async handleAutocomplete(interaction: BaseInteraction<CacheType>) {
    if (!interaction.isAutocomplete()) {
      return
    }

    const focusedValue = interaction.options.getFocused(true)
    if (focusedValue.name !== 'card') return;

    const channelId = interaction.channelId;
    const draftChannel = this.snapshotStore.getDraftChannel(channelId);

    if (!draftChannel) {
      await interaction.respond([]);
      return;
    }

    const draftState = await this.draftService.getDraftState(draftChannel);
    const availableCards = draftState?.availableCards.map(c => c.name) ?? [];
    const filtered = filterCards(availableCards, focusedValue.value);

    await interaction.respond(
      filtered.slice(0, 25).map(card => ({
        name: card,
        value: card,
      }))
    );
  }
}

export {
  DiscordBot,
}