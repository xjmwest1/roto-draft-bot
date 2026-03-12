import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, ModalSubmitInteraction, CacheType, ButtonBuilder, ButtonStyle } from 'discord.js';
import { ConfigStore } from './config-store.js';
import { GoogleSheetsRepository } from './sheets-repository.js';
import { DraftService } from './draft-service.js';
import { DraftPoller } from './poller.js';

export class DraftBot {
  private client: Client;
  private configStore: ConfigStore;
  private sheetsRepository: GoogleSheetsRepository | null = null;
  private draftService: DraftService | null = null;
  private poller: DraftPoller | null = null;
  private cardCache: Map<string, { cards: string[]; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60 * 1000; // 60 seconds

  constructor() {
    console.log('🤖 Initializing DraftBot...');
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
    });

    console.log('📦 Initializing ConfigStore...');
    this.configStore = new ConfigStore(process.env.SQLITE_PATH);
    
    console.log('⚙️ Setting up event handlers...');
    this.setupEventHandlers();
    console.log('✨ DraftBot initialized');
  }

  private ensureRepositories() {
    if (!this.sheetsRepository) {
      console.log('🔑 Lazy-initializing GoogleSheetsRepository...');
      this.sheetsRepository = new GoogleSheetsRepository();
    }
    if (!this.draftService) {
      console.log('📊 Lazy-initializing DraftService...');
      this.draftService = new DraftService(this.sheetsRepository!, this.configStore);
    }
    if (!this.poller) {
      console.log('🔄 Lazy-initializing DraftPoller...');
      this.poller = new DraftPoller(
        this.client,
        this.configStore,
        this.sheetsRepository!,
        this.draftService!
      );
    }
  }

  private setupEventHandlers() {
    this.client.on('ready', () => {
      console.log(`✅ Bot logged in as ${this.client.user?.tag}`);
      this.registerSlashCommands();
      
      // Start the poller
      this.ensureRepositories();
      this.poller!.start();

      // Resolve Discord IDs for all existing draft channels
      this.initializePlayerDiscordIds().catch((error) => {
        console.error('Error initializing player Discord IDs:', error);
      });
    });

    this.client.on('interactionCreate', async (interaction) => {
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
    });
  }

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

  private async handleDraftCommand(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'attach') {
      await this.handleDraftAttach(interaction);
    } else if (subcommand === 'status') {
      await this.handleDraftStatus(interaction);
    }
  }

  private async handleDraftAttach(interaction: ChatInputCommandInteraction) {
    this.ensureRepositories();
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
      // Validate sheet exists and has expected structure
      const sheetData = await this.sheetsRepository!.getSheetData(sheetId);

      if (!sheetData.setup.players || sheetData.setup.players.length === 0) {
        return interaction.reply({
          content: '❌ Could not find players in the Setup sheet. Please check the sheet structure.',
          ephemeral: true,
        });
      }

      // Store the mapping
      const guildId = interaction.guildId || 'unknown';
      const channelId = interaction.channelId;

      this.configStore.attachDraftSheet(guildId, channelId, sheetId, sheetUrl);

      // Resolve Discord usernames to IDs
      try {
        const guild = await this.client.guilds.fetch(guildId);
        if (guild) {
          await this.resolvePlayerDiscordIds(sheetData.setup.players, guild);
        }
      } catch (error) {
        console.warn('Could not resolve Discord usernames:', error);
      }

      // Initialize snapshot with current pick count to avoid announcing existing picks
      const initialPickCount = sheetData.draft.picks.length;
      this.configStore.updateSnapshot(channelId, initialPickCount, '');

      const embed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('✅ Draft Sheet Attached')
        .addFields([
          { name: 'Players', value: sheetData.setup.players.map((p) => p.name).join(', ') || 'None' },
          { name: 'Cards in Cube', value: sheetData.cube.cards.length.toString() },
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
    this.ensureRepositories();
    const channelId = interaction.channelId;
    const draftChannel = this.configStore.getDraftChannel(channelId);

    if (!draftChannel) {
      return interaction.reply({
        content: '❌ No draft sheet is attached to this channel. Use `/draft attach` to get started.',
        ephemeral: true,
      });
    }

    try {
      const guild = await this.client.guilds.fetch(draftChannel.guildId).catch(() => null);
      const draftState = await this.draftService!.getDraftState(draftChannel.sheetId, guild || undefined);

      const embed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('📊 Draft Status')
        .addFields([
          { name: 'Players', value: draftState.players.map((p) => p.name).join(', ') || 'None' },
          { name: 'Total Picks', value: draftState.totalPicks.toString() },
          { name: 'Cards Remaining', value: draftState.availableCards.length.toString() },
          {
            name: 'Current Drafter',
            value: draftState.currentDrafter?.name || 'None',
          },
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

  private async handlePickCommand(interaction: ChatInputCommandInteraction) {
    this.ensureRepositories();
    const cardName = interaction.options.getString('card', true);
    const channelId = interaction.channelId;

    const draftChannel = this.configStore.getDraftChannel(channelId);
    if (!draftChannel) {
      return interaction.reply({
        content: '❌ No draft sheet is attached to this channel. Use `/draft attach` to get started.',
        ephemeral: true,
      });
    }

    try {
      const guild = await this.client.guilds.fetch(draftChannel.guildId).catch(() => null);
      const draftState = await this.draftService!.getDraftState(draftChannel.sheetId, guild || undefined);

      // Find the card
      const card = draftState.availableCards.find(c => c.name.toLowerCase() === cardName.toLowerCase());
      if (!card) {
        return interaction.reply({
          content: '❌ Card not found in available cards.',
          ephemeral: true,
        });
      }

      // Query Scryfall for card details
      const scryfallCard = await this.queryScryfallCard(card.name);
      
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

  private async queryScryfallCard(cardName: string): Promise<any> {
    const encodedName = encodeURIComponent(cardName);
    const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodedName}`);
    
    if (!response.ok) {
      // Fallback: try fuzzy search if exact match fails
      const fuzzyResponse = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodedName}`);
      if (!fuzzyResponse.ok) {
        throw new Error(`Card not found on Scryfall: ${cardName}`);
      }
      return fuzzyResponse.json();
    }
    
    return response.json();
  }

  private async handlePickConfirmButton(interaction: any) {
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
    const userId = interaction.user.id;

    const draftChannel = this.configStore.getDraftChannel(channelId);
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

      this.ensureRepositories();
      
      // Fetch guild for Discord ID resolution
      const guild = await this.client.guilds.fetch(draftChannel.guildId).catch(() => null);

      // Re-read sheet to ensure latest state
      const draftState = await this.draftService!.getDraftState(draftChannel.sheetId, guild || undefined);

      // Validate the pick
      const currentDrafter = draftState.currentDrafter;
      const card = draftState.availableCards.find(c => c.name === cardName);

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

      // Check if user is the current drafter
      const userDrafter = draftState.players.find(p => p.discordId === userId);
      console.log(`userId ${userId}, userDrafter ${userDrafter?.discordId}, currentDrafter ${currentDrafter?.discordId}`);

      if (!userDrafter || userDrafter.discordId !== currentDrafter?.discordId) {
        return interaction.editReply({
          content: `❌ It is not your turn. ${currentDrafter.name} is up.`,
        });
      }

      // Write pick to sheet
      await this.sheetsRepository!.writePick(draftChannel.sheetId, userDrafter.name, cardName);

      // Acknowledge the pick
      await interaction.editReply({
        content: `✅ Pick confirmed: **${cardName}** by ${userDrafter.name}`,
      });

      // Clear the card cache since the draft state changed
      this.cardCache.delete(draftChannel.sheetId);
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

  private async handleAutocomplete(interaction: any) {
    if (!interaction.isAutocomplete()) return;

    const focusedValue = interaction.options.getFocused(true);
    if (focusedValue.name !== 'card') return;

    const channelId = interaction.channelId;
    const draftChannel = this.configStore.getDraftChannel(channelId);

    if (!draftChannel) {
      await interaction.respond([]);
      return;
    }

    try {
      this.ensureRepositories();

      // Check cache
      const now = Date.now();
      const cached = this.cardCache.get(draftChannel.sheetId);
      let availableCards: string[];

      if (cached && now - cached.timestamp < this.CACHE_TTL) {
        availableCards = cached.cards;
      } else {
        // Fetch fresh data
        const draftState = await this.draftService!.getDraftState(draftChannel.sheetId);
        availableCards = draftState.availableCards.map(c => c.name);
        
        // Cache it
        this.cardCache.set(draftChannel.sheetId, {
          cards: availableCards,
          timestamp: now,
        });
      }

      // Filter cards based on input
      const filtered = this.filterCards(availableCards, focusedValue.value);

      // Return top 25 results
      await interaction.respond(
        filtered.slice(0, 25).map(card => ({
          name: card,
          value: card,
        }))
      );
    } catch (error) {
      console.error('Error in autocomplete:', error);
      await interaction.respond([]);
    }
  }

  private filterCards(allCards: string[], input: string): string[] {
    if (!input) return allCards.sort();

    const lowerInput = input.toLowerCase();
    
    // Score each card based on matching priority
    const scored = allCards.map(card => {
      const lowerCard = card.toLowerCase();
      let score = 0;

      // Priority 1: Prefix match
      if (lowerCard.startsWith(lowerInput)) {
        score = 1000;
      }
      // Priority 2: Word prefix match
      else if (lowerCard.split(/\s+/).some(word => word.startsWith(lowerInput))) {
        score = 500;
      }
      // Priority 3: Substring match
      else if (lowerCard.includes(lowerInput)) {
        score = 100;
      }

      return { card, score };
    });

    // Filter to only cards with matches, sort by score descending
    return scored
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ card }) => card);
  }

  private async initializePlayerDiscordIds() {
    try {
      const draftChannels = this.configStore.getAllDraftChannels();
      
      console.log(`🔍 Initializing player Discord IDs for ${draftChannels.length} draft channel(s)...`);

      for (const draftChannel of draftChannels) {
        try {
          // Fetch the guild
          const guild = await this.client.guilds.fetch(draftChannel.guildId);
          if (!guild) {
            console.warn(`⚠️ Could not find guild ${draftChannel.guildId} for channel ${draftChannel.channelId}`);
            continue;
          }

          // Fetch the sheet data
          this.ensureRepositories();
          const sheetData = await this.sheetsRepository!.getSheetData(draftChannel.sheetId);

          // Resolve Discord IDs
          await this.resolvePlayerDiscordIds(sheetData.setup.players, guild);
          console.log(`✅ Resolved Discord IDs for draft channel ${draftChannel.channelId}`);
        } catch (error) {
          console.warn(`⚠️ Error initializing Discord IDs for channel ${draftChannel.channelId}:`, error);
        }
      }
    } catch (error) {
      console.error('Error in initializePlayerDiscordIds:', error);
    }
  }

  private async resolvePlayerDiscordIds(players: any[], guild: any) {
    for (const player of players) {
      if (!player.discord) continue;

      try {
        // Check if we already have this ID cached
        const cached = this.configStore.getPlayerDiscordId(guild.id, player.name);
        if (cached) {
          player.discordId = cached.discordId;
          console.log(`⚡ Using cached Discord ID for ${player.name}: ${cached.discordId}`);
          continue;
        }

        // Try to find member by username
        const members = await guild.members.search({ query: player.discord, limit: 1 });
        if (members && members.size > 0) {
          const member = members.first();
          if (member) {
            player.discordId = member.id;
            this.configStore.savePlayerDiscordId(guild.id, player.name, member.id);
            console.log(`✅ Resolved ${player.name} (${player.discord}) to Discord ID ${member.id}`);
          }
        } else {
          console.warn(`⚠️ Could not find Discord user for ${player.name} (${player.discord})`);
        }
      } catch (error) {
        console.warn(`Error resolving ${player.name} (${player.discord}):`, error);
      }
    }
  }

  async login() {
    const TOKEN = process.env.DISCORD_TOKEN;
    
    if (!TOKEN) {
      throw new Error('DISCORD_TOKEN is required');
    }

    await this.client.login(TOKEN);
  }

  async logout() {
    // Stop the poller
    if (this.poller) {
      this.poller.stop();
    }
    
    this.configStore.close();
    await this.client.destroy();
  }
}
