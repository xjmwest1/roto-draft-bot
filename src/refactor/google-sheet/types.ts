type Player = {
  name: string
  discordUsername: string
}

type Card = {
  name: string
  picked: boolean
}

type DraftPick = {
  player: string;
  cards: string[];
}

type SetupSheetData = {
  players: Player[]
}

type CubeSheetData = {
  cards: Card[]
}

type DraftSheetData = {
  nextPick?: {
    name: string
    row: number
    col: number
  }
  picks: DraftPick[]
}

type SheetData = {
  setup: SetupSheetData
  cube: CubeSheetData
  draft: DraftSheetData
}

export type {
  Player,
  Card,
  DraftPick,
  SetupSheetData,
  CubeSheetData,
  DraftSheetData,
  SheetData,
}