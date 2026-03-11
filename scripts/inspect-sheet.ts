#!/usr/bin/env node
import {google} from 'googleapis';
import {GoogleAuth} from 'google-auth-library';
import fs from 'fs';
import { Player, Card, DraftPick, SheetData } from '../src/sheets-repository.js';

async function main() {
  const sheetId = process.env.SHEET_ID || process.argv[2];
  if (!sheetId) {
    console.error('Usage: provide SHEET_ID via env or as first arg. Example: npm run inspect-sheet -- <sheetId>');
    process.exit(1);
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './GOOGLE_APPLICATION_CREDENTIALS.json';
  console.log('Using credentials file:', credPath);
  console.log('Credentials file exists:', fs.existsSync(credPath));

  const auth = new GoogleAuth({
    keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './GOOGLE_APPLICATION_CREDENTIALS.json',
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({version: 'v4', auth: auth as any});

  const ranges = ['Setup!A:Z', 'Cube!A:Z', 'Draft!A:Z'];
  try {
    const res = await sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges,
    });

    const valueRanges = res.data.valueRanges || [];

    const findValues = (tabName: string) => {
      const r = valueRanges.find(v => v.range && v.range.startsWith(tabName + '!'));
      return r?.values || [];
    };

    const setupRaw = findValues('Setup');
    const cubeRaw = findValues('Cube');
    const draftRaw = findValues('Draft');

    const sheetData: SheetData = {
      setup: { players: [] },
      cube: { cards: [] },
      draft: { picks: [] },
    };

    // ===== SETUP =====
    console.log('\n=== Setup Sheet ===');
    if (setupRaw.length === 0) {
      console.log('No Setup tab data found or it is empty.');
    } else {
      let inPlayers = false;
      for (const row of setupRaw) {
        if (row[1] === 'Players') {
          inPlayers = true;
          continue;
        }
        if (inPlayers && row[1] && row[1].trim() !== '') {
          sheetData.setup.players.push({
            name: row[1].trim(),
            discord: row[2] ? row[2].trim() : undefined,
          });
        } else if (inPlayers && (!row[1] || row[1].trim() === '')) {
          break;
        }
      }
      console.log(`Detected players (${sheetData.setup.players.length}):`);
      sheetData.setup.players.forEach((p, i) => {
        console.log(`  ${i}: ${p.name}${p.discord ? ` (${p.discord})` : ''}`);
      });
    }

    // ===== CUBE =====
    console.log('\n=== Cube Sheet ===');
    if (cubeRaw.length === 0) {
      console.log('No Cube tab data found or it is empty.');
    } else {
      const validCards = cubeRaw.slice(1).filter(r => r[1] && String(r[1]).trim() !== '');
      validCards.forEach(row => {
        const isPicked = row[0] === '✓';
        sheetData.cube.cards.push({
          picked: isPicked,
          name: String(row[1]).trim(),
          picked_by: undefined,
        });
      });
      const pickedCount = sheetData.cube.cards.filter(c => c.picked).length;
      console.log(`Total valid cards: ${sheetData.cube.cards.length}`);
      console.log(`Picked cards: ${pickedCount}`);
      console.log(`Available cards: ${sheetData.cube.cards.length - pickedCount}`);
    }

    console.log('\n=== Draft Sheet ===');
    if (draftRaw.length === 0) console.log('No Draft tab data found or it is empty.');
    else {
      console.log(`${draftRaw.length} rows`);
      const numPlayers = sheetData.setup.players.length;
      const pickColStart = 2; // Column C (0-indexed)
      const pickColEnd = pickColStart + numPlayers - 1;

      // Parse snake draft: check rows starting from row 3 (index 3, which is row 4 in 1-based)
      let completedRounds = 0;
      let currentRoundIndex = -1;
      let emptyColIndex = -1;
      let currentRoundDirection = 'unknown';
      let picksPerRound = 0;

      // Debug: show sample rows around the pick area
      console.log(`\nDraft structure (rows 3-8, columns B-K):`);
      for (let rowIdx = 3; rowIdx < Math.min(9, draftRaw.length); rowIdx++) {
        const row = draftRaw[rowIdx];
        if (!row) continue;
        const cells = [];
        for (let colIdx = 1; colIdx <= 10; colIdx++) {
          const cell = row[colIdx];
          cells.push(`${String(cell || '').substring(0, 8)}`);
        }
        console.log(`  Row ${rowIdx + 1}: ${cells.join(' | ')}`);
      }

      for (let rowIdx = 3; rowIdx < draftRaw.length; rowIdx++) {
        const row = draftRaw[rowIdx];
        if (!row) break;

        // Count picks in this round by checking columns C onwards
        let pickCount = 0;
        let firstFilledCol = -1;
        let lastFilledCol = -1;
        let firstEmpty = -1;
        let lastEmpty = -1;
        for (let colIdx = pickColStart; colIdx <= pickColEnd; colIdx++) {
          const cell = row[colIdx];
          const isEmpty = !cell || String(cell).trim() === '';
          if (!isEmpty) {
            pickCount++;
            if (firstFilledCol === -1) firstFilledCol = colIdx;
            lastFilledCol = colIdx;
          } else if (firstEmpty === -1) {
            firstEmpty = colIdx;
          }
          lastEmpty = colIdx;
        }

        // Determine direction from arrow or infer from pick positions
        const arrowB = row[1] ? String(row[1]).trim() : '';
        const arrowK = row[pickColEnd + 1] ? String(row[pickColEnd + 1]).trim() : '';
        
        let isLeftToRight = false;
        let isRightToLeft = false;

        if (arrowB === '↪' || arrowK === '↪') {
          isLeftToRight = true;
        } else if (arrowB === '↩' || arrowK === '↩') {
          isRightToLeft = true;
        } else if (pickCount > 0) {
          // Auto-detect direction from pick pattern
          // If first filled is closer to C, it's left-to-right; closer to J, it's right-to-left
          const midpoint = (pickColStart + pickColEnd) / 2;
          isLeftToRight = firstFilledCol < midpoint;
          isRightToLeft = !isLeftToRight;
        }

        // Also check the column after the last player (pickColEnd + 1) for extra cards
        const extraCell = row[pickColEnd + 1];
        const hasExtraCell = extraCell && String(extraCell).trim() !== '' && !['↪', '↩', '→'].includes(String(extraCell).trim());

        if (isLeftToRight || isRightToLeft) {
          // This is a valid pick row
          if (completedRounds === 0 && pickCount > 0) {
            picksPerRound = pickCount + (hasExtraCell ? 1 : 0);
          }

          const expectedPickCount = picksPerRound - (hasExtraCell ? 1 : 0);
          if (pickCount >= expectedPickCount && firstEmpty === -1) {
            // Row is complete (all expected cells filled, no gaps)
            completedRounds++;
          } else if (pickCount < picksPerRound && pickCount > 0) {
            // Row is incomplete
            currentRoundIndex = rowIdx;
            currentRoundDirection = isLeftToRight ? 'left-to-right' : 'right-to-left';
            emptyColIndex = isLeftToRight ? firstEmpty : lastEmpty;
            break;
          }
        } else if (pickCount === 0) {
          // No picks and no valid direction, we've reached the end
          break;
        }
      }

      const pickedCount = completedRounds * numPlayers;
      console.log(`Completed rounds: ${completedRounds}`);
      console.log(`Picks per round: ${picksPerRound} (${numPlayers} players ${picksPerRound > numPlayers ? '+ extras' : ''})`);
      console.log(`Total picks made: ${pickedCount}`);

      // First, map arrow spans to determine direction for each row
      const arrowSpans: { startRow: number; endRow: number; arrow: string; cardsPerPerson: number }[] = [];
      for (let rowIdx = 3; rowIdx < draftRaw.length; rowIdx++) {
        const row = draftRaw[rowIdx];
        if (!row) break;
        
        const arrowB = row[1] ? String(row[1]).trim() : '';
        if (['↪', '↩', '→'].includes(arrowB)) {
          // Found an arrow, determine its span
          let endRow = rowIdx;
          for (let checkIdx = rowIdx + 1; checkIdx < draftRaw.length; checkIdx++) {
            const checkRow = draftRaw[checkIdx];
            if (!checkRow) break;
            const checkArrow = checkRow[1] ? String(checkRow[1]).trim() : '';
            if (checkArrow === arrowB) {
              endRow = checkIdx;
            } else {
              break;
            }
          }
          const span = endRow - rowIdx + 1;
          const cardsPerPerson = span / 2;
          arrowSpans.push({ startRow: rowIdx, endRow, arrow: arrowB, cardsPerPerson });
          rowIdx = endRow; // Skip to end of span
        }
      }

      // Build draft picks array from sheet using arrow spans
      for (let rowIdx = 3; rowIdx < draftRaw.length; rowIdx++) {
        const row = draftRaw[rowIdx];
        if (!row) break;

        // Check if this row has picks
        let hasPicks = false;
        for (let colIdx = pickColStart; colIdx <= pickColEnd + 1; colIdx++) {
          const cell = row[colIdx];
          if (cell && String(cell).trim() !== '' && !['↪', '↩', '→'].includes(String(cell).trim())) {
            hasPicks = true;
            break;
          }
        }

        if (!hasPicks && sheetData.draft.picks.length === 0) continue;
        if (!hasPicks) break;

        // Find which arrow span this row belongs to
        let currentArrow = '→'; // default
        let isSecondHalf = false;
        for (const span of arrowSpans) {
          if (rowIdx >= span.startRow && rowIdx <= span.endRow) {
            currentArrow = span.arrow;
            const midPoint = span.startRow + Math.floor((span.endRow - span.startRow) / 2);
            isSecondHalf = rowIdx > midPoint;
            break;
          }
        }

        // Determine direction based on arrow and which half of its span
        let isLeftToRight = true; // default
        if (currentArrow === '→') {
          isLeftToRight = true;
        } else if (currentArrow === '↪') {
          // ↪: last half is L→R, so first half is R→L
          isLeftToRight = isSecondHalf;
        } else if (currentArrow === '↩') {
          // ↩: last half is R→L, so first half is L→R
          isLeftToRight = !isSecondHalf;
        }

        // Iterate columns in appropriate order
        if (isLeftToRight) {
          // Left-to-right (C to J)
          for (let colIdx = pickColStart; colIdx <= pickColEnd; colIdx++) {
            const cell = row[colIdx];
            if (cell && String(cell).trim() !== '') {
              const playerIdx = colIdx - pickColStart;
              const player = sheetData.setup.players[playerIdx];
              if (player) {
                // Always create a new pick object for each cell
                sheetData.draft.picks.push({ player: player.name, cards: [String(cell).trim()] });
              }
            }
          }
        } else {
          // Right-to-left (J to C)
          for (let colIdx = pickColEnd; colIdx >= pickColStart; colIdx--) {
            const cell = row[colIdx];
            if (cell && String(cell).trim() !== '') {
              const playerIdx = colIdx - pickColStart;
              const player = sheetData.setup.players[playerIdx];
              if (player) {
                // Always create a new pick object for each cell
                sheetData.draft.picks.push({ player: player.name, cards: [String(cell).trim()] });
              }
            }
          }
        }

        // Handle extra cell (column K) - determine which player it belongs to based on direction
        const extraCell = row[pickColEnd + 1];
        if (extraCell && String(extraCell).trim() !== '' && !['↪', '↩'].includes(String(extraCell).trim())) {
          // The extra cell goes to the last player in the processing direction
          // In L→R: Ian (rightmost), In R→L: Chill (leftmost)
          const extraCardPlayer = isLeftToRight 
            ? sheetData.setup.players[numPlayers - 1] 
            : sheetData.setup.players[0];
          if (extraCardPlayer) {
            sheetData.draft.picks.push({ 
              player: extraCardPlayer.name, 
              cards: [String(extraCell).trim()] 
            });
          }
        }
      }

      if (currentRoundIndex >= 0 && emptyColIndex >= 0) {
        const playerIndex = emptyColIndex - pickColStart;
        const currentDrafter = sheetData.setup.players[playerIndex];
        console.log(`\nCurrent round: ${completedRounds + 1} (${currentRoundDirection})`);
        console.log(`Current drafter: ${currentDrafter?.name || 'unknown'}`);
      }

      // Update cube with picked_by info
      sheetData.draft.picks.forEach(pick => {
        pick.cards.forEach(card => {
          const cubeCard = sheetData.cube.cards.find(c => c.name === card);
          if (cubeCard) {
            cubeCard.picked = true;
            cubeCard.picked_by = pick.player;
          }
        });
      });
    }

    // Output final structured data
    console.log('\n=== Structured Data ===');
    console.log(JSON.stringify(sheetData, null, 2));

  } catch (err) {
    console.error('Error reading spreadsheet:', err);
    process.exit(2);
  }
}

main().catch(err => {
  console.error('Unhandled error in main():', err);
  if (err && err.stack) console.error(err.stack);
  process.exit(2);
});

process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err);
  if (err && err.stack) console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason);
  if (reason && (reason as any).stack) console.error((reason as any).stack);
});
