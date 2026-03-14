import { google, Auth, sheets_v4 } from 'googleapis'
import type { Card, CubeSheetData, DraftPick, DraftSheetData, Player, SetupSheetData, SheetData } from './types.js'

class GoogleSheetsRepository {
  private auth: Auth.GoogleAuth
  private sheets: sheets_v4.Sheets

  constructor() {
    this.auth = new google.auth.GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    })
    this.sheets = google.sheets({ version: 'v4', auth: this.auth })
  }

  async getSheetData(sheetId: string): Promise<SheetData> {
    const ranges = ['Setup!A:Z', 'Cube!A:Z', 'Draft!A:Z']

    const response = await this.sheets.spreadsheets.values.batchGet({
      spreadsheetId: sheetId,
      ranges,
    })

    const valueRanges = response.data.valueRanges ?? []
    const [setupSheet, cubeSheet, draftSheet] = valueRanges

    const setup = this.parseSetupSheet(setupSheet)
    const cube = this.parseCubeSheet(cubeSheet)
    const draft = await this.parseDraftSheet(draftSheet, sheetId)

    return {
      setup,
      cube,
      draft,
    }
  }

  async writeNextPick(sheetId: string, cardName: string): Promise<boolean> {
    const sheetData = await this.getSheetData(sheetId)
    const nextPick = sheetData.draft.nextPick

    if (!nextPick) {
      return false
    }

    const column = String.fromCharCode(65 + nextPick?.col);
    const cell = `${column}${nextPick.row + 1}`;

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `Draft!${cell}`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[cardName]],
      },
    });

    return true
  }

  private parseSetupSheet(setupSheet: sheets_v4.Schema$ValueRange): SetupSheetData {
    const setupRaw = (setupSheet.values ?? []) as (string | undefined)[][]
    let inPlayers = false
    const players: Player[] = []

    setupRaw.forEach((row, index) => {
      if (row[1] === 'Players') {
        inPlayers = true
        return
      }

      if (!inPlayers) {
        return
      }

      if (!row[1] || row[1].trim() === '') {
        inPlayers = false
        return
      }

      if (!row[2] || row[2].trim() === '') {
        console.warn(`Unable to parse discord username at Sheets!C${index+1}`)
        return
      }

      players.push({
        name: row[1].trim(),
        discordUsername: row[2].trim(),
      })
    })

    return {
      players,
    }
  }

  private parseCubeSheet(cubeSheet: sheets_v4.Schema$ValueRange): CubeSheetData {
    const cubeRaw = (cubeSheet.values ?? []) as (string | undefined)[][]
    const cards: Card[] = []

    for (const row of cubeRaw.slice(1)) {
      if (!row[1] || String(row[1]).trim() === '') {
        continue
      }

      const isPicked = row[0] === '✓' || (row[5]?.trim().length ?? 0) > 0
      cards.push({
        picked: isPicked,
        name: String(row[1]).trim(),
      })
    }

    return {
      cards,
    }
  }

  private async parseDraftSheet(draftSheet: sheets_v4.Schema$ValueRange, sheetId: string): Promise<DraftSheetData> {
    const draftRaw = (draftSheet.values ?? []) as (string | undefined)[][]

    const playersRow = 2
    const firstRoundRow = 3
    const firstPlayerColumn = 2

    let lastPlayerColumn = 2

    while (draftRaw[2][lastPlayerColumn + 1] ?? '' !== '') {
      lastPlayerColumn++
    }

    let numDraftPicksRows = 1
    while (draftRaw[numDraftPicksRows + 2 + 1]?.[0] ?? '' !== '') {
      numDraftPicksRows++
    }

    const arrowColumn = await this.sheets.spreadsheets.get({
      spreadsheetId: sheetId,
      ranges: ['Draft!B:B'],
      fields: 'sheets(properties/title,merges)',
    })
    const arrowColumnMerges = arrowColumn.data.sheets?.[0].merges ?? []
    const picks: DraftPick[] = []

    let currDraftPicksRow = 3
    let nextPickCell: { row: number, col: number } | undefined

    while (currDraftPicksRow < firstRoundRow + numDraftPicksRows && !nextPickCell) {      
      // determine direction and pick count
      const merge = arrowColumnMerges.find((merge) => 
        ((merge.startRowIndex ?? 0) <= currDraftPicksRow) && 
        ((merge.endRowIndex ?? 0) > currDraftPicksRow)
      )
      const mergeHeight = (merge?.endRowIndex ?? 1) - (merge?.startRowIndex ?? 0)
      const numPicksinRound = Math.ceil(mergeHeight / 2)

      let direction: 'LtR' | 'RtL'
      if (mergeHeight > 1) {
        const isTopHalf = mergeHeight - (merge?.endRowIndex! - 1 - currDraftPicksRow) <= numPicksinRound
        direction = isTopHalf ? 'RtL' : 'LtR'
      } else {
        direction = 'LtR'
      }

      // iterate row(s) and add picks
      if (direction === 'LtR') {
        for (let currCol = firstPlayerColumn; currCol <= lastPlayerColumn; currCol++) {
          const cardCell = draftRaw[currDraftPicksRow][currCol]

          if ((cardCell ?? '') === '') {
            nextPickCell = {
              row: currDraftPicksRow,
              col: currCol,
            }
            break
          }
          const normalizedPlayer = String(draftRaw[playersRow][currCol]).split('◈').join('').trim()
          picks.push({ cards: [cardCell!], player: normalizedPlayer })
        }
      } else {
        for (let currCol = lastPlayerColumn; currCol >= firstPlayerColumn; currCol--) {
          const cardCell = draftRaw[currDraftPicksRow][currCol]

          if ((cardCell ?? '') === '') {
            nextPickCell = {
              row: currDraftPicksRow,
              col: currCol,
            }
            break
          }
          const normalizedPlayer = String(draftRaw[playersRow][currCol]).split('◈').join('').trim()
          picks.push({ cards: [cardCell!], player: normalizedPlayer })
        }
      }

      // goto next round
      currDraftPicksRow += numPicksinRound
    }

    const nextPick = nextPickCell ? {
      name: String(draftRaw[0][5]).trim(),
      row: nextPickCell.row,
      col: nextPickCell.col,
    } : undefined

    return {
      nextPick,
      picks,
    }
  }
}

export { GoogleSheetsRepository }