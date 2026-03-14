interface DraftChannel {
  guildId: string
  channelId: string
  sheetId: string
  sheetUrl: string
  createdAt: Date
  updatedAt: Date
}

interface DraftSnapshot {
  channelId: string
  lastSeenPickCount: number
  lastAnnouncedPickKey: string
  updatedAt: Date
}

interface PlayerDiscordId {
  guildId: string
  playerName: string
  discordId: string
  updatedAt: Date
}

export type {
  DraftChannel,
  DraftSnapshot,
  PlayerDiscordId,
}