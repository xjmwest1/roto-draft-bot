export type DraftChannel = {
  guildId: string;
  channelId: string;
  sheetId: string;
  sheetUrl: string;
  createdAt: Date;
  updatedAt: Date;
};

export type DraftSnapshot = {
  channelId: string;
  lastSeenPickCount: number;
  lastAnnouncedPickKey: string;
  updatedAt: Date;
};

export type PlayerDiscordId = {
  guildId: string;
  playerName: string;
  discordId: string;
  updatedAt: Date;
};

export type QueuedPick = {
  channelId: string;
  playerName: string;
  cardName: string;
  updatedAt: Date;
};