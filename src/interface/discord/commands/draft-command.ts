import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder, codeBlock } from 'discord.js';
import type { CommandContext } from '../command-context.js';
import type { CommandModule } from './command-module.js';

function parseSheetIdFromUrl(sheetUrl: string): string | null {
  const match = sheetUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match?.[1] ?? null;
}

async function resolveAndStoreDiscordIds(
  ctx: CommandContext,
  guildId: string,
  players: { name: string; discordUsername: string }[]
) {
  for (const player of players) {
    const discordId = await ctx.memberResolver.resolveDiscordIdByUsername(guildId, player.discordUsername);
    if (discordId) {
      ctx.playerDiscordIds.savePlayerDiscordId(guildId, player.name, discordId);
    }
  }
}

async function handleAttach(interaction: ChatInputCommandInteraction, ctx: CommandContext) {
  const sheetUrl = interaction.options.getString('sheet_url', true);
  const sheetId = parseSheetIdFromUrl(sheetUrl);

  if (!sheetId) {
    await interaction.reply({
      content: '❌ Invalid Google Sheets URL. Please provide a full sheet URL.',
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId || 'unknown';
  const channelId = interaction.channelId;
  const { draftState } = await ctx.attachDraftSheet.execute({ guildId, channelId, sheetId, sheetUrl });

  try {
    await resolveAndStoreDiscordIds(ctx, guildId, draftState.players);
  } catch (error) {
    console.warn('Could not resolve Discord usernames:', error);
  }

  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle('✅ Draft Sheet Attached')
    .addFields([
      { name: 'Players', value: draftState.players.map((p) => p.name).join(', ') || 'None' },
      {
        name: 'Completed picks',
        value: `${draftState.picks.length}/${draftState.availableCards.length + draftState.picks.length}`,
      },
      { name: 'Next pick', value: draftState.currentDrafterName ?? 'Unknown' },
    ]);

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleStatus(interaction: ChatInputCommandInteraction, ctx: CommandContext) {
  const result = await ctx.getDraftStatus.execute({ channelId: interaction.channelId });
  if (!result.ok) {
    await interaction.reply({
      content: '❌ No draft sheet is attached to this channel. Use `/draft attach` to get started.',
      ephemeral: true,
    });
    return;
  }
  const { draftState } = result;

  const queuedPicks = ctx.queuedPicksStore.getQueuedPicks(interaction.channelId)

  const embeds: EmbedBuilder[] = []
  const components = []

  embeds.push(new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`${draftState.cube.name} Draft Status`)
    .addFields([
      { name: 'Players', value: draftState.players.map((p) => p.name).join(', ') || 'None' },
      { name: 'Picks', value: `${draftState.picks.length}/${draftState.availableCards.length + draftState.picks.length}` },
      { name: 'Next pick', value: draftState.currentDrafterName ?? 'Unknown' },
    ]));

  const userQueuedPicks = queuedPicks.filter((pick) => {
    if (pick.channelId !== interaction.channelId) {
      return false
    }

    if (interaction.guildId === null) {
      return false
    }
    
    const pickDiscordId = ctx.playerDiscordIds.getPlayerDiscordId(interaction.guildId, pick.playerName)?.discordId
    return pickDiscordId === interaction.user.id
  })

  if (userQueuedPicks.length > 0) {
    const pickEmbed = new EmbedBuilder()
      .setTitle(`Your Queued Pick`)
      .addFields(userQueuedPicks.map((pick) => ({
        name: pick.cardName,
        value: ''
      }))
    )

    const cancelButton = new ButtonBuilder()
    .setCustomId('draft:queue:clear')
    .setLabel('Clear queued pick')
    .setStyle(ButtonStyle.Secondary);

    const actionRow = new ActionRowBuilder<ButtonBuilder>()
      .addComponents(cancelButton);

    embeds.push(pickEmbed)
    components.push(actionRow)
  }

  await interaction.reply({ embeds, ephemeral: true, components });
}

export function createDraftCommand(): CommandModule {
  const command = new SlashCommandBuilder()
    .setName('draft')
    .setDescription('Manage draft setup')
    .addSubcommand((subcommand) =>
      subcommand
        .setName('attach')
        .setDescription('Attach a Google Sheet to this channel for draft tracking')
        .addStringOption((option) =>
          option.setName('sheet_url').setDescription('The URL of the draft Google Sheet').setRequired(true)
        )
    )
    .addSubcommand((subcommand) => subcommand.setName('status').setDescription('Show the current draft status'));

  return {
    name: 'draft',
    command,
    onChatInput: async (interaction, ctx) => {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'attach') return handleAttach(interaction, ctx);
      if (subcommand === 'status') return handleStatus(interaction, ctx);
      await interaction.reply({
        content: `Unknown subcommand.\n${codeBlock('/draft attach sheet_url:<url>')}\n${codeBlock('/draft status')}`,
        ephemeral: true,
      });
    },
    onButton: async (interaction, ctx) => {
      await interaction.deferReply({ ephemeral: true });

      if (interaction.customId === 'draft:queue:clear') {
        const draftStatus = await ctx.getDraftStatus.execute({ channelId: interaction.channelId })

        if (!draftStatus.ok) {
          await interaction.editReply({ content: 'Something went wrong' });
          return;
        }

        const player = draftStatus.draftState.players.find((player) => player.discordUsername === interaction.user.username)
        if (!player) {
          await interaction.editReply({ content: 'Something went wrong' });
          return;
        }

        ctx.queuedPicksStore.clearQueuedPick(interaction.channelId, player.name)
        await interaction.editReply({ content: 'Successfully cleared your queued pick!' });
      }
    },
  };
}

