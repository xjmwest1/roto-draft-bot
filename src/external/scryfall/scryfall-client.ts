export type ScryfallCard = {
  image_uris?: {
    normal?: string;
  };
};

export function filterCards(allCards: string[], input: string): string[] {
  if (!input) return allCards.sort();

  const lowerInput = input.toLowerCase();
  const scored = allCards.map((card) => {
    const lowerCard = card.toLowerCase();
    let score = 0;

    if (lowerCard.startsWith(lowerInput)) {
      score = 1000;
    } else if (lowerCard.split(/\s+/).some((word) => word.startsWith(lowerInput))) {
      score = 500;
    } else if (lowerCard.includes(lowerInput)) {
      score = 100;
    }

    return { card, score };
  });

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ card }) => card);
}

export async function queryScryfallCard(cardName: string): Promise<ScryfallCard> {
  const encodedName = encodeURIComponent(cardName);
  const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodedName}`);

  if (!response.ok) {
    const fuzzyResponse = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodedName}`);
    if (!fuzzyResponse.ok) {
      throw new Error(`Card not found on Scryfall: ${cardName}`);
    }
    return fuzzyResponse.json();
  }

  return response.json();
}

