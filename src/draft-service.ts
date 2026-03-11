import { GoogleSheetsRepository, SheetData, Player, Card, DraftPick } from './sheets-repository.js';
import { ConfigStore } from './config-store.js';

export interface DraftState {
  players: Player[];
  availableCards: Card[];
  picks: DraftPick[];
  currentDrafter?: Player;
  totalPicks: number;
}

export class DraftService {
  private repository: GoogleSheetsRepository;
  private configStore: ConfigStore;

  constructor(repository: GoogleSheetsRepository, configStore: ConfigStore) {
    this.repository = repository;
    this.configStore = configStore;
  }

  async getDraftState(sheetId: string, guild?: any): Promise<DraftState> {
    const sheetData = await this.repository.getSheetData(sheetId);

    // Resolve Discord IDs if guild is provided
    if (guild) {
      await this.resolvePlayerDiscordIds(sheetData.setup.players, guild);
    }

    const availableCards = sheetData.cube.cards.filter(card => !card.picked);
    const currentDrafter = this.getCurrentDrafter(sheetData);

    return {
      players: sheetData.setup.players,
      availableCards,
      picks: sheetData.draft.picks,
      currentDrafter,
      totalPicks: sheetData.draft.picks.length,
    };
  }

  private async resolvePlayerDiscordIds(players: any[], guild: any) {
    for (const player of players) {
      if (!player.discord) continue;

      try {
        // Check if we already have this ID cached
        const cached = this.configStore.getPlayerDiscordId(guild.id, player.name);
        if (cached) {
          player.discordId = cached.discordId;
          continue;
        }

        // Try to find member by username
        const members = await guild.members.search({ query: player.discord, limit: 1 });
        if (members && members.size > 0) {
          const member = members.first();
          if (member) {
            player.discordId = member.id;
            this.configStore.savePlayerDiscordId(guild.id, player.name, member.id);
          }
        }
      } catch (error) {
        // Silently continue if resolution fails
      }
    }
  }

  getCurrentDrafter(sheetData: SheetData): Player | undefined {
    const numPlayers = sheetData.setup.players.length;
    if (numPlayers === 0) return undefined;

    const pickColStart = 2; // Column C
    const pickColEnd = pickColStart + numPlayers - 1;

    let completedRounds = 0;
    let currentRoundIndex = -1;
    let currentRoundDirection: 'left-to-right' | 'right-to-left' = 'left-to-right';
    let emptyColIndex = -1;

    // Find the current round and drafter
    for (let rowIdx = 3; rowIdx < sheetData.draft.picks.length + 3; rowIdx++) {
      // This is a simplified version - in practice we'd need to parse the actual sheet rows
      // For now, we'll use the pick count to determine current drafter
    }

    // Simplified logic: assume snake draft pattern
    const totalPicks = sheetData.draft.picks.length;
    const roundNumber = Math.floor(totalPicks / numPlayers) + 1;
    const pickInRound = totalPicks % numPlayers;

    let drafterIndex: number;
    if (roundNumber % 2 === 1) {
      // Odd rounds: left to right (0 to numPlayers-1)
      drafterIndex = pickInRound;
    } else {
      // Even rounds: right to left (numPlayers-1 to 0)
      drafterIndex = numPlayers - 1 - pickInRound;
    }

    return sheetData.setup.players[drafterIndex];
  }

  getAvailableCards(sheetData: SheetData): Card[] {
    return sheetData.cube.cards.filter(card => !card.picked);
  }

  validatePick(sheetData: SheetData, playerName: string, cardName: string): { valid: boolean; reason?: string } {
    // Check if player is the current drafter
    const currentDrafter = this.getCurrentDrafter(sheetData);
    if (!currentDrafter || currentDrafter.name !== playerName) {
      return { valid: false, reason: 'It is not your turn to pick' };
    }

    // Check if card is available
    const card = sheetData.cube.cards.find(c => c.name === cardName);
    if (!card) {
      return { valid: false, reason: 'Card not found in cube' };
    }

    if (card.picked) {
      return { valid: false, reason: 'Card has already been picked' };
    }

    return { valid: true };
  }

  detectNewPicks(oldState: DraftState, newState: DraftState): DraftPick[] {
    const oldPickCount = oldState.totalPicks;
    const newPickCount = newState.totalPicks;

    if (newPickCount <= oldPickCount) {
      return [];
    }

    return newState.picks.slice(oldPickCount);
  }
}