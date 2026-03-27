import type { DraftSnapshot } from '../types.js';

export interface DraftSnapshotStorePort {
  getSnapshot(channelId: string): DraftSnapshot | null;
  updateSnapshot(channelId: string, lastSeenPickCount: number, lastAnnouncedPickKey: string): void;
}

