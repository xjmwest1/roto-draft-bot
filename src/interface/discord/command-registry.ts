import { createDraftCommand } from './commands/draft-command.js';
import { createPickCommand } from './commands/pick-command.js';
import type { CommandModule } from './commands/command-module.js';

export function buildCommandModules(): CommandModule[] {
  return [createDraftCommand(), createPickCommand()];
}

