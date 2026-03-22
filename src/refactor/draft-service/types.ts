type Player = {
  name: string
  discordUsername: string
  discordId: string
}

type PlayerFromSheet = Omit<Player, 'discordId'>

type Card = {
  name: string
}

type DraftPick = {
  player: string;
  cards: string[];
}

type DraftState = {
  players: PlayerFromSheet[];
  availableCards: Card[];
  picks: DraftPick[];
  currentDrafter?: PlayerFromSheet;
}

type MakePickResult =
  {
    valid: true
  } |
  {
    valid: false,
    reason: 'INVALID_CHANNEL',
  }

type ValidatePickResult =
  {
    valid: true
  } |
  {
    valid: false,
    reason: 'INVALID_PLAYER' | 'INVALID_CARD' | 'INVALID_CHANNEL',
  }

export type {
  Player,
  PlayerFromSheet,
  Card,
  DraftPick,
  DraftState,
  MakePickResult,
  ValidatePickResult,
}