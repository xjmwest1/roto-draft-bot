import { getIdWithUsername } from '../discord-api/get-id-with-username.js'
import { DraftChannel } from '../draft-snapshot-store/types.js'
import { GoogleSheetsRepository } from '../google-sheet/index.js'
import type { DraftState, MakePickResult, Player, ValidatePickResult } from './types.js'

class DraftService {
  constructor(
    private sheetsRepository: GoogleSheetsRepository,
  ) {}

  async getDraftState(draftChannel: DraftChannel): Promise<DraftState | null> {
    const { sheetId } = draftChannel

    const sheetData = await this.sheetsRepository.getSheetData(sheetId)

    const availableCards = sheetData.cube.cards.filter((card) => !card.picked)
    const picks = sheetData.draft.picks
    
    const players = sheetData.setup.players

    const currentDrafter = players.find((player) =>
      player.name.toLowerCase() === sheetData.draft.nextPick?.name.toLowerCase()
    )

    return {
      availableCards,
      picks,
      players,
      currentDrafter,
    }
  }
  
  async validatePick(draftChannel: DraftChannel, playerName: string, cardName: string): Promise<ValidatePickResult> {
    const draftState = await this.getDraftState(draftChannel)
    if (!draftState) {
      return { valid: false, reason: 'INVALID_CHANNEL' }
    }
    const { availableCards, currentDrafter } = draftState

    if (!currentDrafter || currentDrafter.name.toLowerCase() !== playerName.toLowerCase()) {
      return { valid: false, reason: 'INVALID_PLAYER' };
    }

    const cardAvailable = availableCards.some((card) => card.name.toLowerCase() === cardName.toLowerCase())
    if (!cardAvailable) {
      return { valid: false, reason: 'INVALID_CARD' }
    }

    return { valid: true }
  }

  async makePick(draftChannel: DraftChannel, cardName: string): Promise<MakePickResult> {
    const draftState = await this.getDraftState(draftChannel)
    if (!draftState) {
      return { valid: false, reason: 'INVALID_CHANNEL' }
    }

    this.sheetsRepository.writeNextPick(draftChannel.sheetId, cardName)
    return { valid: true }

  }
}

export {
  DraftService,
}