import { google } from 'googleapis';
import { GoogleAuth } from 'google-auth-library';

export interface Player {
  name: string;
  discord?: string; // Discord username from sheet
  discordId?: string; // Resolved Discord user ID
}

export interface Card {
  picked: boolean;
  name: string;
  picked_by?: string;
}

export interface DraftPick {
  player: string;
  cards: string[];
}

export interface SheetData {
  setup: {
    players: Player[];
  };
  cube: {
    cards: Card[];
  };
  draft: {
    picks: DraftPick[];
  };
}

export class GoogleSheetsRepository {
  private auth: GoogleAuth;
  private sheets: any;

  constructor() {
    this.auth = new GoogleAuth({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS || './GOOGLE_APPLICATION_CREDENTIALS.json',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets = google.sheets({ version: 'v4', auth: this.auth as any });
  }

  async getSheetData(sheetId: string): Promise<SheetData> {
    const ranges = ['Setup!A:Z', 'Cube!A:Z', 'Draft!A:Z'];

    const res = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges,
    });

    const valueRanges = res.data.valueRanges || [];

    const findValues = (tabName: string) => {
      const r = valueRanges.find((v: any) => v.range && v.range.startsWith(tabName + '!'));
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

    this.parseSetupSheet(setupRaw, sheetData);
    this.parseCubeSheet(cubeRaw, sheetData);
    this.parseDraftSheet(draftRaw, sheetData);

    return sheetData;
  }

  private parseSetupSheet(setupRaw: any[][], sheetData: SheetData) {
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
  }

  private parseCubeSheet(cubeRaw: any[][], sheetData: SheetData) {
    for (const row of cubeRaw.slice(1)) {
      // row[0] = checkmark column, row[1] = card name column
      if (row[1] && String(row[1]).trim() !== '') {
        const isPicked = row[0] === '✓';
        sheetData.cube.cards.push({
          picked: isPicked,
          name: String(row[1]).trim(),
          picked_by: undefined,
        });
      }
    }
  }

  private parseDraftSheet(draftRaw: any[][], sheetData: SheetData) {
    const numPlayers = sheetData.setup.players.length;
    if (numPlayers === 0) return;

    const pickColStart = 2; // Column C
    const pickColEnd = pickColStart + numPlayers - 1;

    // Map arrow spans to determine direction for each row
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
        rowIdx = endRow;
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
            cards: [String(extraCell).trim()],
          });
        }
      }
    }

    // Update cube with picked_by info
    sheetData.draft.picks.forEach((pick) => {
      pick.cards.forEach((card) => {
        const cubeCard = sheetData.cube.cards.find((c) => c.name === card);
        if (cubeCard) {
          cubeCard.picked = true;
          cubeCard.picked_by = pick.player;
        }
      });
    });
  }

  async writePick(sheetId: string, playerName: string, cardName: string): Promise<void> {
    // Re-read the sheet data to ensure we have the latest state
    const sheetData = await this.getSheetData(sheetId);

    // Find the player
    const playerIndex = sheetData.setup.players.findIndex(p => p.name === playerName);
    if (playerIndex === -1) {
      throw new Error(`Player "${playerName}" not found`);
    }

    // Get the raw draft sheet
    const ranges = ['Draft!A:Z'];
    const res = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges,
    });
    const draftRaw = res.data.valueRanges?.[0]?.values || [];

    const numPlayers = sheetData.setup.players.length;
    const pickColStart = 2; // Column C (0-based)
    const pickColEnd = pickColStart + numPlayers - 1;

    // Map arrow spans to determine direction for each row
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
        rowIdx = endRow;
      }
    }

    // Find the current incomplete row (the one we need to write to)
    let currentRowIdx = -1;
    let currentRowNumber = -1;
    let currentDirection = '→';

    for (let rowIdx = 3; rowIdx < draftRaw.length; rowIdx++) {
      const row = draftRaw[rowIdx];
      if (!row) break;

      // Check if this row has any picks
      let hasPicks = false;
      for (let colIdx = pickColStart; colIdx <= pickColEnd + 1; colIdx++) {
        const cell = row[colIdx];
        if (cell && String(cell).trim() !== '' && !['↪', '↩', '→'].includes(String(cell).trim())) {
          hasPicks = true;
          break;
        }
      }

      // Skip empty rows at the beginning
      if (!hasPicks && sheetData.draft.picks.length === 0) continue;

      // If this row is empty and we've found picks before, this is the first unused row
      if (!hasPicks && sheetData.draft.picks.length > 0) {
        // Use this row as the next pick row
        currentRowIdx = rowIdx;
        currentRowNumber = rowIdx + 1;
        currentDirection = '→'; // Default direction for new rows

        // Find which arrow span this row belongs to (to determine direction)
        for (const span of arrowSpans) {
          if (rowIdx >= span.startRow && rowIdx <= span.endRow) {
            const midPoint = span.startRow + Math.floor((span.endRow - span.startRow) / 2);
            const isSecondHalf = rowIdx > midPoint;
            let isLeftToRight = true;
            if (span.arrow === '→') {
              isLeftToRight = true;
            } else if (span.arrow === '↪') {
              isLeftToRight = isSecondHalf;
            } else if (span.arrow === '↩') {
              isLeftToRight = !isSecondHalf;
            }
            currentDirection = isLeftToRight ? 'L→R' : 'R→L';
            break;
          }
        }

        // The next drafter is player 0 for L→R or player numPlayers-1 for R→L
        let nextEmptyCol = -1;
        if (currentDirection === 'L→R') {
          nextEmptyCol = pickColStart;
        } else {
          nextEmptyCol = pickColEnd;
        }

        if (nextEmptyCol !== -1) {
          const nextPlayerIdx = nextEmptyCol - pickColStart;
          const nextPlayer = sheetData.setup.players[nextPlayerIdx];
          console.log(`Current pick location: Row ${currentRowNumber} (${currentDirection}), Player ${nextPlayer?.name || 'unknown'} (col ${String.fromCharCode(65 + nextEmptyCol)})`);
          
          // Write the pick to the correct cell
          const column = String.fromCharCode(65 + nextEmptyCol);
          const cell = `${column}${currentRowNumber}`;

          await this.sheets.spreadsheets.values.update({
            spreadsheetId: sheetId,
            range: `Draft!${cell}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
              values: [[cardName]],
            },
          });

          // Mark card as picked in Cube sheet
          const cardRowIndex = sheetData.cube.cards.findIndex(c => c.name === cardName);
          if (cardRowIndex !== -1) {
            const cubeRow = 2 + cardRowIndex;
            await this.sheets.spreadsheets.values.update({
              spreadsheetId: sheetId,
              range: `Cube!A${cubeRow}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: {
                values: [['✓']],
              },
            });
          }
          return;
        }
      }

      // If row has picks, check if it's complete or incomplete
      if (hasPicks) {
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

        // Determine direction
        let isLeftToRight = true;
        if (currentArrow === '→') {
          isLeftToRight = true;
        } else if (currentArrow === '↪') {
          isLeftToRight = isSecondHalf;
        } else if (currentArrow === '↩') {
          isLeftToRight = !isSecondHalf;
        }

        // Count picks in this row
        let pickCount = 0;
        let firstEmpty = -1;
        let lastEmpty = -1;
        for (let colIdx = pickColStart; colIdx <= pickColEnd; colIdx++) {
          const cell = row[colIdx];
          const isEmpty = !cell || String(cell).trim() === '';
          if (isEmpty) {
            if (firstEmpty === -1) firstEmpty = colIdx;
            lastEmpty = colIdx;
          } else {
            pickCount++;
          }
        }

        // Check for extra cell
        const extraCell = row[pickColEnd + 1];
        const hasExtraCell = extraCell && String(extraCell).trim() !== '' && !['↪', '↩'].includes(String(extraCell).trim());

        // Determine if this row is complete
        const expectedPickCount = numPlayers + (hasExtraCell ? 1 : 0);
        const isComplete = pickCount === numPlayers && firstEmpty === -1;

        if (!isComplete && pickCount > 0) {
          // This is the current incomplete row
          currentRowIdx = rowIdx;
          currentRowNumber = rowIdx + 1; // Convert to 1-based
          currentDirection = isLeftToRight ? 'L→R' : 'R→L';

          // Find the next empty column based on direction
          let nextEmptyCol = -1;
          if (isLeftToRight) {
            // L→R: find first empty from left
            nextEmptyCol = firstEmpty;
          } else {
            // R→L: find first empty from right
            nextEmptyCol = lastEmpty;
          }

          if (nextEmptyCol !== -1) {
            const nextPlayerIdx = nextEmptyCol - pickColStart;
            const nextPlayer = sheetData.setup.players[nextPlayerIdx];
            console.log(`Current pick location: Row ${currentRowNumber} (${currentDirection}), Player ${nextPlayer?.name || 'unknown'} (col ${String.fromCharCode(65 + nextEmptyCol)})`);
            
            // Write the pick to the correct cell
            const column = String.fromCharCode(65 + nextEmptyCol);
            const cell = `${column}${currentRowNumber}`;

            await this.sheets.spreadsheets.values.update({
              spreadsheetId: sheetId,
              range: `Draft!${cell}`,
              valueInputOption: 'USER_ENTERED',
              requestBody: {
                values: [[cardName]],
              },
            });

            // Mark card as picked in Cube sheet
            const cardRowIndex = sheetData.cube.cards.findIndex(c => c.name === cardName);
            if (cardRowIndex !== -1) {
              const cubeRow = 2 + cardRowIndex;
              await this.sheets.spreadsheets.values.update({
                spreadsheetId: sheetId,
                range: `Cube!A${cubeRow}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: {
                  values: [['✓']],
                },
              });
            }
            return;
          }
        }
      }
    }

    throw new Error('Could not find a valid location to write the pick. The draft may be complete.');
  }
}
