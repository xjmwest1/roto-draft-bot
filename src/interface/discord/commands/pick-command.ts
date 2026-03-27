import {
  ActionRowBuilder,
  AutocompleteInteraction,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from 'discord.js';
import { filterCards } from '../../../external/scryfall/scryfall-client.js';
import type { CommandContext } from '../command-context.js';
import type { CommandModule } from './command-module.js';

const pickConfirmPrefix = 'pick:confirm:';

function makeConfirmCustomId(channelId: string, cardName: string): string {
  return `${pickConfirmPrefix}${channelId}:${encodeURIComponent(cardName)}`;
}

function parseConfirmCustomId(customId: string): { channelId: string; cardName: string } | null {
  if (customId.startsWith(pickConfirmPrefix)) {
    const rest = customId.slice(pickConfirmPrefix.length);
    const idx = rest.indexOf(':');
    if (idx <= 0) return null;
    return { channelId: rest.slice(0, idx), cardName: decodeURIComponent(rest.slice(idx + 1)) };
  }
  const legacy = customId.match(/^confirm_pick_(\d+)_(.+)$/);
  return legacy ? { channelId: legacy[1], cardName: legacy[2] } : null;
}

async function handleChatInput(interaction: ChatInputCommandInteraction, ctx: CommandContext) {
  const result = await ctx.preparePickConfirmation.execute({
    channelId: interaction.channelId,
    cardName: interaction.options.getString('card', true),
  });

  if (!result.ok) {
    await interaction.reply({
      content:
        result.reason === 'NO_DRAFT_ATTACHED'
          ? '❌ No draft sheet is attached to this channel. Use `/draft attach` to get started.'
          : '❌ Card not found in available cards.',
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Pick: ${result.resolvedCardName}`)
    .setColor('#0099ff')
    .setImage(result.cardImageUrl || '');

  const confirmBtn = new ButtonBuilder()
    .setCustomId(makeConfirmCustomId(interaction.channelId, result.resolvedCardName))
    .setLabel('Confirm Pick')
    .setStyle(ButtonStyle.Success);

  await interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn)],
    ephemeral: true,
  });
}

async function handleButton(interaction: ButtonInteraction, ctx: CommandContext) {
  const parsed = parseConfirmCustomId(interaction.customId);
  if (!parsed) return;

  await interaction.deferReply({ ephemeral: true });
  const result = await ctx.confirmPick.execute({
    channelId: parsed.channelId,
    actorDiscordId: interaction.user.id,
    cardName: parsed.cardName,
  });

  if (!result.ok) {
    const msg =
      result.reason === 'NO_DRAFT_ATTACHED'
        ? '❌ Draft configuration not found.'
        : result.reason === 'UNKNOWN_CURRENT_DRAFTER'
          ? '❌ Could not determine current drafter.'
          : result.reason === 'CARD_NOT_AVAILABLE'
            ? '❌ Card is no longer available.'
            : '❌ It is not your turn.';
    await interaction.editReply({ content: msg });
    return;
  }

  const makeQueuePick = async (channelId: string, nextDrafterName?: string, nextCardName?: string) => {
    if (!nextDrafterName || !nextCardName) {
      return;
    }

    const nextDrafterDiscordId = ctx.playerDiscordIds.getPlayerDiscordId(channelId, nextDrafterName)?.discordId;
    if (!nextDrafterDiscordId) {
      return;
    }
    const queueResult = await ctx.confirmPick.execute({
      channelId: channelId,
      actorDiscordId: nextDrafterDiscordId,
      cardName: nextCardName,
      isQueuePick: true,
    });

    if (queueResult.ok && queueResult.nextDrafterName && queueResult.nextCardName) {
      return makeQueuePick(channelId, queueResult.nextDrafterName, queueResult.nextCardName);
    } 
  }
  
  makeQueuePick(parsed.channelId, result.nextDrafterName, result.nextCardName);

  await interaction.editReply({
    content: `✅ ${result.wasQueuePick ? 'Queue pick confirmed: ' : 'Pick confirmed: '}**${result.pickedCardName}** by ${result.actorPlayerName}`,
  });
}

async function handleAutocomplete(interaction: AutocompleteInteraction, ctx: CommandContext) {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'card') return;

  const draftChannel = ctx.channelStore.getDraftChannel(interaction.channelId);
  if (!draftChannel) {
    await interaction.respond([]);
    return;
  }

  const draftState = await ctx.draftRepo.getDraftState(draftChannel.sheetId);
  const filtered = filterCards(
    draftState.availableCards.map((c) => c.name),
    focused.value
  );
  await interaction.respond(filtered.slice(0, 25).map((card) => ({ name: card, value: card })));
}

export function createPickCommand(): CommandModule {
  const command = new SlashCommandBuilder()
    .setName('pick')
    .setDescription('Make a draft pick')
    .addStringOption((option) =>
      option.setName('card').setDescription('The card to pick').setRequired(true).setAutocomplete(true)
    );

  return {
    name: 'pick',
    command,
    onChatInput: handleChatInput,
    onButton: handleButton,
    onAutocomplete: handleAutocomplete,
  };
}

