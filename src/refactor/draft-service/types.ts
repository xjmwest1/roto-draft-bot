type Player = {
  name: string
  discordUsername: string
}

type Card = {
  name: string
}

type DraftPick = {
  player: string;
  cards: string[];
}

type DraftState = {
  players: Player[];
  availableCards: Card[];
  picks: DraftPick[];
  currentDrafter?: Player;
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
  Card,
  DraftPick,
  DraftState,
  MakePickResult,
  ValidatePickResult,
}