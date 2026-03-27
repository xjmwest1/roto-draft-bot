export type Player = {
  name: string;
  discordUsername: string;
};

export type Card = {
  name: string;
};

export type DraftPick = {
  playerName: string;
  cardNames: string[];
};

export type CubeInfo = {
  name: string;
  link: string;
}

export type DraftState = {
  players: Player[];
  availableCards: Card[];
  picks: DraftPick[];
  currentDrafterName?: string;
  cube: CubeInfo;
};

export type CheckQueueResult =
  | { hasQueuedPick: true, nextDrafterName: string, nextCardName: string }
  | { hasQueuedPick: false };