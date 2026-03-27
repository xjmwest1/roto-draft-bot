import type { AutocompleteInteraction, ButtonInteraction, CacheType, ChatInputCommandInteraction, Interaction } from 'discord.js';
import type { CommandContext } from './command-context.js';
import type { CommandModule } from './commands/command-module.js';

export class InteractionDispatcher {
  private commandByName: Map<string, CommandModule>;
  private buttonHandlers: CommandModule[];

  constructor(private modules: CommandModule[], private ctx: CommandContext) {
    this.commandByName = new Map(modules.map((m) => [m.name, m]));
    this.buttonHandlers = modules.filter((m) => !!m.onButton);
  }

  async dispatch(interaction: Interaction<CacheType>): Promise<void> {
    if (interaction.isChatInputCommand()) return this.dispatchChatInput(interaction);
    if (interaction.isAutocomplete()) return this.dispatchAutocomplete(interaction);
    if (interaction.isButton()) return this.dispatchButton(interaction);
  }

  private async dispatchChatInput(interaction: ChatInputCommandInteraction): Promise<void> {
    const mod = this.commandByName.get(interaction.commandName);
    if (!mod?.onChatInput) return;
    await mod.onChatInput(interaction, this.ctx);
  }

  private async dispatchAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const mod = this.commandByName.get(interaction.commandName);
    if (!mod?.onAutocomplete) return;
    await mod.onAutocomplete(interaction, this.ctx);
  }

  private async dispatchButton(interaction: ButtonInteraction): Promise<void> {
    for (const mod of this.buttonHandlers) {
      await mod.onButton?.(interaction, this.ctx);
      if (interaction.replied || interaction.deferred) return;
    }
  }
}

