import type { AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction } from 'discord.js';
import type { CommandContext } from '../command-context.js';

export type CommandModule = {
  name: string;
  command: { toJSON(): unknown };
  onChatInput?: (interaction: ChatInputCommandInteraction, ctx: CommandContext) => Promise<void>;
  onAutocomplete?: (interaction: AutocompleteInteraction, ctx: CommandContext) => Promise<void>;
  onButton?: (interaction: ButtonInteraction, ctx: CommandContext) => Promise<void>;
};

