import dotenv from 'dotenv';
import { GoogleSheetsDraftRepository } from '../src/external/google-sheets/google-sheets-draft-repository.js';

dotenv.config();

async function main() {
  const sheetId = process.env.SHEET_ID || process.argv[2];
  if (!sheetId) {
    console.error('Usage: provide SHEET_ID via env or as first arg');
    process.exit(1);
  }

  const draftRepo = new GoogleSheetsDraftRepository();

  try {
    console.log('Fetching draft state...');
    const draftState = await draftRepo.getDraftState(sheetId);

    console.log('\n=== Draft State ===');
    console.log(`Players: ${draftState.players.map(p => p.name).join(', ')}`);
    console.log(`Available cards: ${draftState.availableCards.length}`);
    console.log(`Total picks: ${draftState.picks.length}`);
    console.log(`Current drafter: ${draftState.currentDrafterName || 'None'}`);

    console.log('\n=== Recent Picks ===');
    draftState.picks.slice(-5).forEach((pick, i) => {
      console.log(
        `${draftState.picks.length - 5 + i + 1}. ${pick.playerName}: ${pick.cardNames.join(', ')}`
      );
    });

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();