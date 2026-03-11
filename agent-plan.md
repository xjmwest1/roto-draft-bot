# Discord Rotisserie MTG Draft Bot — Agentic Development Plan

## Overview

This document describes the agentic development plan for building a Discord bot that supports **Rotisserie MTG drafts using the Anthony Mattox Google Sheets template**.

Key goals:

* Discord users make draft picks via slash command
* Picks are written directly to the Google Sheet
* Picks made directly in the sheet are announced in Discord
* The bot pings the next drafter
* Google Sheets remains the **source of truth**
* One draft per Discord channel

Template:
[https://docs.google.com/spreadsheets/d/1gwZvYiY8yIKss2_PMMbK5R5FD6MAqawb9BWUCgZyewo/edit](https://docs.google.com/spreadsheets/d/1gwZvYiY8yIKss2_PMMbK5R5FD6MAqawb9BWUCgZyewo/edit)

---

# Architecture (MVP)

For the MVP the simplest architecture is:

**Always-on Node.js Discord bot**

Components:

* discord.js bot
* Google Sheets API client
* SQLite database
* 1 minute polling loop

Why this architecture:

* simplest to implement
* avoids serverless complexity
* supports autocomplete + modal flows easily
* supports polling easily

---

# Core Product Decisions

These assumptions are fixed for MVP.

* One draft per Discord channel
* Channel admin manually attaches sheet URL
* Discord user mapping exists in Setup sheet
* Only the current player may submit a pick
* No admin overrides
* Bot writes directly into Draft sheet
* Google Sheets is source of truth
* Announcements happen in same channel
* Slash commands produce ephemeral responses
* Next player is pinged
* Card pool comes from Cube sheet
* Checked cards are unavailable
* Poll every 60 seconds
* Template structure is assumed stable

---

# UX Design

## Admin Setup

Slash command:

`/draft attach sheet_url:<url>`

Behavior:

* validate sheet exists
* verify expected tabs
* store mapping channel → sheet

Response is ephemeral.

---

## Player Pick Flow

Slash command:

`/pick card:<autocomplete>`

Flow:

1. User types `/pick`
2. Autocomplete suggests cards from Cube sheet
3. User selects card
4. Confirmation modal appears
5. User confirms
6. Bot validates pick
7. Bot writes pick to sheet
8. Bot announces pick in channel
9. Bot pings next drafter

---

## Sheet Direct Picks

Flow:

1. User edits sheet directly
2. Poller detects new pick
3. Bot announces pick in channel
4. Bot pings next drafter

---

# System Components

## Discord Adapter

Responsibilities:

* slash command registration
* autocomplete handler
* modal handler
* channel announcements

---

## Google Sheets Adapter

Responsibilities:

* read Setup sheet
* read Cube sheet
* read Draft sheet
* write pick into Draft sheet

---

## Draft Domain Layer

Responsibilities:

* map Discord user → drafter
* determine current drafter
* determine available cards
* validate picks
* detect newly completed picks
* determine next drafter

---

## Poller

Responsibilities:

* poll sheets every minute
* detect new picks
* announce picks
* update snapshot state

---

## Config Store

SQLite database used to store:

* channel → sheet mappings
* last known draft state
* dedupe information

---

# Database Schema

## draft_channels

* guild_id
* channel_id
* sheet_id
* sheet_url
* created_at
* updated_at

---

## draft_snapshots

* channel_id
* last_seen_pick_count
* last_announced_pick_key
* updated_at

---

# Sheet Parsing Model

## Setup Sheet

Read:

* player names
* Discord user IDs

Used to map Discord users to drafters.

---

## Cube Sheet

Read:

* card name
* checkbox column

Available cards = unchecked rows.

---

## Draft Sheet

Read:

* completed picks
* next open slot
* current drafter

Bot writes new pick into next slot.

---

# Announcement Format

Example:

🎯 **Alice** picked **Black Lotus**.

You're up <@discordUserId>

Fallback if Discord mapping missing:

Next up **Bob**

---

# Validation Rules

Validation occurs on submit.

Checks:

1. Channel has attached draft
2. User is registered drafter
3. It is user's turn
4. Card exists
5. Card not already taken
6. Draft slot still open

If validation fails response is ephemeral.

---

# Autocomplete Strategy

Card pool size:

300–500 cards typical

Implementation:

* fetch full cube list once
* cache in memory
* refresh every 60 seconds
* filter locally

Matching priority:

1. prefix
2. word prefix
3. substring

Return top 25 results.

---

# Phase 0 — Template Discovery

Goal:

Confirm sheet structure.

Tasks:

* build inspection script
* read Setup, Cube, Draft sheets
* print draft state

Deliverable:

scripts/inspect-sheet.ts

---

# Phase 1 — Domain Layer

Goal:

Implement sheet parsing + draft logic.

Tasks:

* Google auth
* sheet repository
* parsers

Functions:

* getCurrentDrafter
* getAvailableCards
* validatePick
* detectNewPicks

---

# Phase 2 — Draft Setup Commands

**✅ COMPLETED**

Goal:

Allow channel to attach draft.

Commands:

`/draft attach`

`/draft status`

Store mapping in SQLite.

---

## Implementation Summary

**Files Created:**

* `src/config-store.ts` — SQLite database management with methods for:
  * Attaching draft sheets to channels
  * Storing channel → sheet mappings
  * Managing draft snapshots for polling

* `src/bot.ts` — Discord bot with:
  * Slash command registration system
  * `/draft attach` command handler with sheet URL parsing and validation
  * `/draft status` command handler showing draft state
  * Integration with GoogleSheetsRepository for sheet access
  * Integration with DraftService for draft logic

* `src/app.ts` — Main entry point that:
  * Initializes and logs in the bot
  * Handles graceful shutdown

**Files Modified:**

* `package.json` — Added discord.js and better-sqlite3 dependencies, added `npm run start` script
* `src/sheets-repository.ts` — Updated Google Sheets API scope to include write permissions

**Key Features:**

* Sheet validation - checks that attached sheets have expected structure
* Channel-specific draft management - one draft per Discord channel
* Ephemeral command responses for user feedback
* Error handling with user-friendly messages
* Database persistence with SQLite

**Environment Variables Required:**

* `DISCORD_TOKEN` — Bot token from Discord Developer Portal
* `DISCORD_CLIENT_ID` — Application ID from Discord Developer Portal
* `GOOGLE_APPLICATION_CREDENTIALS` — Path to Google credentials JSON

---

# Phase 3 — Pick Command

Goal:

Card autocomplete.

Tasks:

* register `/pick`
* autocomplete handler
* card filtering
* confirmation modal

---

# Phase 4 — Pick Submission

Goal:

Write picks safely.

Tasks:

* modal submit handler
* lock channel
* re-read sheet
* validate pick
* write pick
* announce pick
* ping next player

---

# Phase 5 — Polling Announcements

**✅ COMPLETED**

Goal:

Detect manual sheet picks.

Tasks:

* poll every 60 seconds
* compare with snapshot
* detect new picks
* send announcements

## Implementation Summary

**Files Created:**

* `src/poller.ts` — DraftPoller class that:
  * Polls every 60 seconds for new picks across all draft channels
  * Compares current draft state with stored snapshot
  * Detects new picks by comparing pick counts
  * Announces picks in Discord channels
  * Pings the next drafter
  * Updates snapshots for deduplication

**Files Modified:**

* `src/config-store.ts` — Added `getAllDraftChannels()` method to retrieve all active draft channels from the database
* `src/bot.ts` — Integrated DraftPoller:
  * Added poller instance to DraftBot
  * Started poller when bot logs in
  * Stopped poller on logout

**Key Features:**

* 60-second polling interval (configurable)
* Efficient snapshot-based deduplication - only announces new picks since last poll
* Discord user mentions with fallback to player names
* Per-channel error handling to prevent one channel's issues from affecting others
* Graceful startup and shutdown
* Polling runs immediately on bot startup, then every 60 seconds

**How It Works:**

1. When bot logs in, poller starts
2. Every 60 seconds, poller fetches all draft channels
3. For each channel:
   - Gets current draft state from Google Sheets
   - Retrieves stored snapshot (last known pick count)
   - Identifies new picks by comparing pick counts
   - If new picks found:
     - Announces each pick in Discord channel
     - Mentions next drafter with Discord ID or player name
     - Updates snapshot to prevent duplicate announcements

---

# Phase 6 — Hardening

Tasks:

* retry Google API errors
* structured logging
* rate limiting
* crash-safe persistence

---

# Acceptance Criteria

The MVP is complete when:

* admin can attach draft sheet
* bot reads Setup players
* Discord users mapped correctly
* `/pick` autocompletes cards
* confirmation modal works
* pick writes to sheet
* pick announced in channel
* next player pinged
* sheet edits detected within 1 minute
* invalid picks rejected
* restart safe

---

# Recommended File Structure

```
src/
  bot/
  domain/
  sheets/
  poller/
  store/
  app/
```

---

# Implementation Order

1. Sheet inspector
2. Parser layer
3. Domain logic
4. `/draft attach`
5. `/pick` autocomplete
6. Modal submit
7. Sheet write
8. Announcements
9. Polling
10. Hardening

---

# Final Notes

The MVP optimizes for:

* simplicity
* minimal infrastructure
* stable sheet integration

Future improvements could include:

* multi-draft support
* real-time sheet webhooks
* Redis caching
* better draft analytics
