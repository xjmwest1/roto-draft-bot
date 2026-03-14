
type ScryfallCard = {
  image_uris?: {
    normal?: string
  }
}

function filterCards(allCards: string[], input: string): string[] {
    if (!input) return allCards.sort();

    const lowerInput = input.toLowerCase();
    
    // Score each card based on matching priority
    const scored = allCards.map(card => {
      const lowerCard = card.toLowerCase();
      let score = 0;

      // Priority 1: Prefix match
      if (lowerCard.startsWith(lowerInput)) {
        score = 1000;
      }
      // Priority 2: Word prefix match
      else if (lowerCard.split(/\s+/).some(word => word.startsWith(lowerInput))) {
        score = 500;
      }
      // Priority 3: Substring match
      else if (lowerCard.includes(lowerInput)) {
        score = 100;
      }

      return { card, score };
    });

    // Filter to only cards with matches, sort by score descending
    return scored
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ card }) => card);
  }

async function queryScryfallCard(cardName: string): Promise<ScryfallCard> {
    const encodedName = encodeURIComponent(cardName);
    const response = await fetch(`https://api.scryfall.com/cards/named?exact=${encodedName}`);
    
    if (!response.ok) {
      // Fallback: try fuzzy search if exact match fails
      const fuzzyResponse = await fetch(`https://api.scryfall.com/cards/named?fuzzy=${encodedName}`);
      if (!fuzzyResponse.ok) {
        throw new Error(`Card not found on Scryfall: ${cardName}`);
      }
      return fuzzyResponse.json();
    }
    
    return response.json();
  }

  export {
    filterCards,
    queryScryfallCard,
  }