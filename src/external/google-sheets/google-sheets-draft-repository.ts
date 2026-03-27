import { google, Auth, sheets_v4 } from 'googleapis';
import type { DraftRepositoryPort } from '../../application/ports/draft-repository-port.js';
import type { DraftPick, DraftState } from '../../domain/draft/types.js';

type SetupPlayer = {
  name: string;
  discordUsername: string;
};

type CubeCard = {
  name: string;
  picked: boolean;
};

type DraftNextPick = {
  name: string;
  row: number;
  col: number;
};

type DraftSheetData = {
  nextPick?: DraftNextPick;
  picks: DraftPick[];
};

type OverviewSheetData = {
  cubeName: string;
  cubeLink: string;
}

export class GoogleSheetsDraftRepository implements DraftRepositoryPort {
  private auth: Auth.GoogleAuth;
  private sheets: sheets_v4.Sheets;

  constructor() {
    this.auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    this.sheets = google.sheets({ version: 'v4', auth: this.auth });
  }

  async getDraftState(sheetId: string): Promise<DraftState> {
    const [players, cards, draft, overview] = await Promise.all([
      this.getSetupPlayers(sheetId),
      this.getCubeCards(sheetId),
      this.getDraftSheetData(sheetId),
      this.getOverviewSheetData(sheetId),
    ]);

    const availableCards = cards.filter((card) => !card.picked).map((card) => ({ name: card.name }));
    const currentDrafterName = players.find(
      (player) => player.name.toLowerCase() === draft.nextPick?.name.toLowerCase()
    )?.name;

    return {
      players,
      availableCards,
      picks: draft.picks,
      currentDrafterName,
      cube: {
        name: overview.cubeName,
        link: overview.cubeLink,
      }
    };
  }

  async writeNextPick(sheetId: string, cardName: string): Promise<void> {
    const draft = await this.getDraftSheetData(sheetId);
    const nextPick = draft.nextPick;
    if (!nextPick) return;

    const column = String.fromCharCode(65 + nextPick.col);
    const cell = `${column}${nextPick.row + 1}`;

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Draft!${cell}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[cardName]],
      },
    });
  }

  private async getSetupPlayers(sheetId: string): Promise<SetupPlayer[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Setup!A:Z',
    });
    const rows = (response.data.values ?? []) as (string | undefined)[][];
    let inPlayers = false;
    const players: SetupPlayer[] = [];

    rows.forEach((row, index) => {
      if (row[1] === 'Players') {
        inPlayers = true;
        return;
      }

      if (!inPlayers) return;

      if (!row[1] || row[1].trim() === '') {
        inPlayers = false;
        return;
      }

      if (!row[2] || row[2].trim() === '') {
        console.warn(`Unable to parse discord username at Setup!C${index + 1}`);
        return;
      }

      players.push({
        name: row[1].trim(),
        discordUsername: row[2].trim(),
      });
    });

    return players;
  }

  private async getCubeCards(sheetId: string): Promise<CubeCard[]> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Cube!A:Z',
    });
    const rows = (response.data.values ?? []) as (string | undefined)[][];
    const cards: CubeCard[] = [];

    for (const row of rows.slice(1)) {
      if (!row[1] || String(row[1]).trim() === '') continue;
      const isPicked = row[0] === '✓' || (row[5]?.trim().length ?? 0) > 0;
      cards.push({
        name: String(row[1]).trim(),
        picked: isPicked,
      });
    }

    return cards;
  }

  private async getDraftSheetData(sheetId: string): Promise<DraftSheetData> {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Draft!A:Z',
    });
    const draftRaw = (response.data.values ?? []) as (string | undefined)[][];

    const playersRow = 2;
    const firstRoundRow = 3;
    const firstPlayerColumn = 2;
    let lastPlayerColumn = 2;

    while (draftRaw[2][lastPlayerColumn + 1] ?? '' !== '') {
      lastPlayerColumn++;
    }

    let numDraftPicksRows = 1;
    while (draftRaw[numDraftPicksRows + 2 + 1]?.[0] ?? '' !== '') {
      numDraftPicksRows++;
    }

    const arrowColumn = await this.sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      ranges: ['Draft!B:B'],
      fields: 'sheets(properties/title,merges)',
    });
    const arrowColumnMerges = arrowColumn.data.sheets?.[0].merges ?? [];

    const picks: DraftPick[] = [];
    let currDraftPicksRow = 3;
    let nextPickCell: { row: number; col: number } | undefined;

    while (currDraftPicksRow < firstRoundRow + numDraftPicksRows && !nextPickCell) {
      const merge = arrowColumnMerges.find(
        (m) => (m.startRowIndex ?? 0) <= currDraftPicksRow && (m.endRowIndex ?? 0) > currDraftPicksRow
      );
      const mergeHeight = (merge?.endRowIndex ?? 1) - (merge?.startRowIndex ?? 0);
      const numPicksInRound = Math.ceil(mergeHeight / 2);

      let direction: 'LtR' | 'RtL';
      if (mergeHeight > 1) {
        const isTopHalf = mergeHeight - ((merge?.endRowIndex ?? 0) - 1 - currDraftPicksRow) <= numPicksInRound;
        direction = isTopHalf ? 'RtL' : 'LtR';
      } else {
        direction = 'LtR';
      }

      if (direction === 'LtR') {
        for (let currCol = firstPlayerColumn; currCol <= lastPlayerColumn; currCol++) {
          const cardCell = draftRaw[currDraftPicksRow][currCol];
          if ((cardCell ?? '') === '') {
            nextPickCell = { row: currDraftPicksRow, col: currCol };
            break;
          }
          const normalizedPlayer = String(draftRaw[playersRow][currCol]).split('◈').join('').trim();
          picks.push({ playerName: normalizedPlayer, cardNames: [cardCell!] });
        }
      } else {
        for (let currCol = lastPlayerColumn; currCol >= firstPlayerColumn; currCol--) {
          const cardCell = draftRaw[currDraftPicksRow][currCol];
          if ((cardCell ?? '') === '') {
            nextPickCell = { row: currDraftPicksRow, col: currCol };
            break;
          }
          const normalizedPlayer = String(draftRaw[playersRow][currCol]).split('◈').join('').trim();
          picks.push({ playerName: normalizedPlayer, cardNames: [cardCell!] });
        }
      }

      currDraftPicksRow += numPicksInRound;
    }

    const nextPick = nextPickCell
      ? {
          name: String(draftRaw[0][5]).trim(),
          row: nextPickCell.row,
          col: nextPickCell.col,
        }
      : undefined;

    return { nextPick, picks };
  }

  private async getOverviewSheetData(sheetId: string): Promise<OverviewSheetData> {
    const name = await this.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Overview!B2',
    });

    const link = await this.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Overview!B7',
    });
    
    return {
      cubeName: name.data.values?.[0][0],
      cubeLink: link.data.values?.[0][0]
    }
  }
}

