import { GoogleSheetsDraftRepository } from '../src/external/google-sheets/google-sheets-draft-repository.js';
import { SqliteDraftStore } from '../src/external/sqlite/sqlite-draft-store.js';
import dotenv from 'dotenv';

dotenv.config()

async function main() {
  const sheetId = process.env.SHEET_ID || process.argv[2];
  if (!sheetId) {
    console.error('Usage: provide SHEET_ID via env or as first arg');
    process.exit(1);
  }

  const draftRepo = new GoogleSheetsDraftRepository();
  const snapshotStore = new SqliteDraftStore()

    snapshotStore.savePlayerDiscordId('123', 'John1', 'id-john1')
  snapshotStore.savePlayerDiscordId('123', 'John2', 'id-john2')
  snapshotStore.savePlayerDiscordId('123', 'John3', 'id-john3')
  snapshotStore.savePlayerDiscordId('123', 'John4', 'id-john4')
  snapshotStore.savePlayerDiscordId('123', 'John5', 'id-john5')
  snapshotStore.savePlayerDiscordId('123', 'John6', 'id-john6')
  snapshotStore.savePlayerDiscordId('123', 'John7', 'id-john7')
  snapshotStore.savePlayerDiscordId('123', 'John8', 'id-john8')


  try {
    console.log('Getting draft state')
    const draftState = await draftRepo.getDraftState(sheetId)
    console.log(draftState)

    console.log('Done');

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();