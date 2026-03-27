import type { DraftChannelStorePort } from '../../application/ports/draft-channel-store-port.js';
import { DraftQueuedPicksStorePort } from '../../application/ports/draft-queued-picks-store-port.js';
import type { DraftSnapshotStorePort } from '../../application/ports/draft-snapshot-store-port.js';
import type { PlayerDiscordIdStorePort } from '../../application/ports/player-discord-id-store-port.js';
import type { DraftChannel, DraftSnapshot, PlayerDiscordId, QueuedPick } from '../../application/types.js';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

export class SqliteDraftStore
  implements DraftChannelStorePort, DraftSnapshotStorePort, PlayerDiscordIdStorePort, 
  DraftQueuedPicksStorePort
{
  private db: Database.Database;

  constructor(dbPath?: string) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const finalPath = dbPath || path.join(__dirname, '..', '..', 'draft-bot.db');
    this.db = new Database(finalPath);
    this.initializeSchema();
  }

  private initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS draft_channels (
        guild_id TEXT NOT NULL,
        channel_id TEXT PRIMARY KEY,
        sheet_id TEXT NOT NULL,
        sheet_url TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS draft_snapshots (
        channel_id TEXT PRIMARY KEY,
        last_seen_pick_count INTEGER NOT NULL DEFAULT 0,
        last_announced_pick_key TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS player_discord_ids (
        guild_id TEXT NOT NULL,
        player_name TEXT NOT NULL,
        discord_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (guild_id, player_name)
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS queued_picks (
        channel_id TEXT NOT NULL,
        player_name TEXT NOT NULL,
        card_name TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (channel_id, player_name)
      )
    `);
  }

  attachDraftSheet(guildId: string, channelId: string, sheetId: string, sheetUrl: string): DraftChannel {
    const now = new Date();
    const stmt = this.db.prepare(`
      INSERT INTO draft_channels (guild_id, channel_id, sheet_id, sheet_url, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        sheet_id = excluded.sheet_id,
        sheet_url = excluded.sheet_url,
        updated_at = excluded.updated_at
    `);

    stmt.run(guildId, channelId, sheetId, sheetUrl, now.toISOString(), now.toISOString());
    return { guildId, channelId, sheetId, sheetUrl, createdAt: now, updatedAt: now };
  }

  getDraftChannel(channelId: string): DraftChannel | null {
    const stmt = this.db.prepare(`
      SELECT guild_id, channel_id, sheet_id, sheet_url, created_at, updated_at
      FROM draft_channels
      WHERE channel_id = ?
    `);
    const row = stmt.get(channelId) as any;
    if (!row) return null;
    return {
      guildId: row.guild_id,
      channelId: row.channel_id,
      sheetId: row.sheet_id,
      sheetUrl: row.sheet_url,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  getAllDraftChannels(): DraftChannel[] {
    const stmt = this.db.prepare(`
      SELECT guild_id, channel_id, sheet_id, sheet_url, created_at, updated_at
      FROM draft_channels
    `);
    const rows = stmt.all() as any[];
    return rows.map((row) => ({
      guildId: row.guild_id,
      channelId: row.channel_id,
      sheetId: row.sheet_id,
      sheetUrl: row.sheet_url,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    }));
  }

  getSnapshot(channelId: string): DraftSnapshot | null {
    const stmt = this.db.prepare(`
      SELECT channel_id, last_seen_pick_count, last_announced_pick_key, updated_at
      FROM draft_snapshots
      WHERE channel_id = ?
    `);
    const row = stmt.get(channelId) as any;
    if (!row) return null;
    return {
      channelId: row.channel_id,
      lastSeenPickCount: row.last_seen_pick_count,
      lastAnnouncedPickKey: row.last_announced_pick_key,
      updatedAt: new Date(row.updated_at),
    };
  }

  updateSnapshot(channelId: string, lastSeenPickCount: number, lastAnnouncedPickKey: string): DraftSnapshot {
    const now = new Date();
    const stmt = this.db.prepare(`
      INSERT INTO draft_snapshots (channel_id, last_seen_pick_count, last_announced_pick_key, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        last_seen_pick_count = excluded.last_seen_pick_count,
        last_announced_pick_key = excluded.last_announced_pick_key,
        updated_at = excluded.updated_at
    `);
    stmt.run(channelId, lastSeenPickCount, lastAnnouncedPickKey, now.toISOString());
    return { channelId, lastSeenPickCount, lastAnnouncedPickKey, updatedAt: now };
  }

  savePlayerDiscordId(guildId: string, playerName: string, discordId: string): PlayerDiscordId {
    const now = new Date();
    const stmt = this.db.prepare(`
      INSERT INTO player_discord_ids (guild_id, player_name, discord_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(guild_id, player_name) DO UPDATE SET
        discord_id = excluded.discord_id,
        updated_at = excluded.updated_at
    `);
    stmt.run(guildId, playerName, discordId, now.toISOString());
    return { guildId, playerName, discordId, updatedAt: now };
  }

  getPlayerDiscordId(guildId: string, playerName: string): PlayerDiscordId | null {
    const stmt = this.db.prepare(`
      SELECT guild_id, player_name, discord_id, updated_at
      FROM player_discord_ids
      WHERE guild_id = ? AND player_name = ?
    `);
    const row = stmt.get(guildId, playerName) as any;
    if (!row) return null;
    return {
      guildId: row.guild_id,
      playerName: row.player_name,
      discordId: row.discord_id,
      updatedAt: new Date(row.updated_at),
    };
  }

  queuePick(channelId: string, playerName: string, cardName: string): QueuedPick {
    const now = new Date();
    const stmt = this.db.prepare(`
      INSERT INTO queued_picks (channel_id, player_name, card_name, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id, player_name) DO UPDATE SET
        card_name = excluded.card_name,
        updated_at = excluded.updated_at
    `);
    stmt.run(channelId, playerName, cardName, now.toISOString());
    return { channelId, playerName, cardName, updatedAt: now };
  }

  getQueuedPicks(channelId: string): QueuedPick[] {
    const stmt = this.db.prepare(`
      SELECT channel_id, player_name, card_name, updated_at
      FROM queued_picks
      WHERE channel_id = ?
    `);
    const rows = stmt.all(channelId) as any[];
    return rows.map((row) => ({
      channelId: row.channel_id,
      playerName: row.player_name,
      cardName: row.card_name,
      updatedAt: new Date(row.updated_at),
    }));
  }

  clearQueuedPick(channelId: string, playerName: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM queued_picks WHERE channel_id = ? AND player_name = ?
    `);
    stmt.run(channelId, playerName);
  }

  close(): void {
    this.db.close();
  }
}

