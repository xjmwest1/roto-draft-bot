import type { CardInfoPort } from '../../application/ports/card-info-port.js';
import { queryScryfallCard } from './scryfall-client.js';

export class ScryfallCardInfo implements CardInfoPort {
  async getCardImage(cardName: string): Promise<{ imageUrl?: string }> {
    const card = await queryScryfallCard(cardName);
    return { imageUrl: card.image_uris?.normal || undefined };
  }
}

