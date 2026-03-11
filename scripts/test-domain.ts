import { GoogleSheetsRepository } from '../src/sheets-repository.js';
import { DraftService } from '../src/draft-service.js';
import { ConfigStore } from '../src/config-store.js';

async function main() {
  const sheetId = process.env.SHEET_ID || process.argv[2];
  if (!sheetId) {
    console.error('Usage: provide SHEET_ID via env or as first arg');
    process.exit(1);
  }

  const repository = new GoogleSheetsRepository();
  const configStore = new ConfigStore();
  const draftService = new DraftService(repository, configStore);

  try {
    console.log('Fetching draft state...');
    const draftState = await draftService.getDraftState(sheetId);

    console.log('\n=== Draft State ===');
    console.log(`Players: ${draftState.players.map(p => p.name).join(', ')}`);
    console.log(`Available cards: ${draftState.availableCards.length}`);
    console.log(`Total picks: ${draftState.totalPicks}`);
    console.log(`Current drafter: ${draftState.currentDrafter?.name || 'None'}`);

    console.log('\n=== Recent Picks ===');
    draftState.picks.slice(-5).forEach((pick, i) => {
      console.log(`${draftState.picks.length - 5 + i + 1}. ${pick.player}: ${pick.cards.join(', ')}`);
    });

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();