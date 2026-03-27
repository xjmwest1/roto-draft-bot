import type { QueuedPick } from '../types.js';

export interface DraftQueuedPicksStorePort {
  queuePick(channelId: string, playerName: string, cardName: string): QueuedPick;
  getQueuedPicks(channelId: string): QueuedPick[];
  clearQueuedPick(channelId: string, playerName: string): void;
}

