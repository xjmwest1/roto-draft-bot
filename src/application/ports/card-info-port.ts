export type CardImageInfo = {
  imageUrl?: string;
};

export interface CardInfoPort {
  getCardImage(cardName: string): Promise<CardImageInfo>;
}

