import type { DraftState } from '../../domain/draft/types.js';

export interface DraftRepositoryPort {
  getDraftState(sheetId: string): Promise<DraftState>;
  writeNextPick(sheetId: string, cardName: string): Promise<void>;
}

