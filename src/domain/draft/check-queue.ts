import { QueuedPick } from '../../application/types';
import { CheckQueueResult, DraftState } from './types.js';

export function checkQueue(draftState: DraftState, queuedPicks: QueuedPick[]): CheckQueueResult {
  const nextDraftersQueuedPick = queuedPicks.find(pick => pick.playerName === draftState.currentDrafterName);
  if (!nextDraftersQueuedPick) {
    return { hasQueuedPick: false };
  }

  return { 
    hasQueuedPick: true, 
    nextDrafterName: nextDraftersQueuedPick.playerName, 
    nextCardName: nextDraftersQueuedPick.cardName,
  };
}