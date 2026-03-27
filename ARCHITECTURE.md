# Architecture

## Overview

This codebase uses a layered architecture:

- `domain`: pure draft model and rules
- `application`: use-cases, ports, and app services
- `external`: adapters for infrastructure/network dependencies
- `interface`: Discord bot transport (commands, dispatch, lifecycle)

The entrypoint `src/app.ts` only bootstraps and starts the bot.

## Layers

### Domain

Location: `src/domain`

- Contains business types and pure logic only
- No imports from Discord, Google APIs, SQLite, or HTTP clients
- Current modules:
  - `src/domain/draft/types.ts`
  - `src/domain/draft/validate-pick.ts`

### Application

Location: `src/application`

- Defines use-cases that orchestrate domain behavior
- Depends on port interfaces, not concrete adapters
- Main components:
  - Ports in `src/application/ports/*`
  - Use-cases in `src/application/use-cases/*`
  - Services in `src/application/services/*`

Key use-cases:

- `AttachDraftSheetUseCase`: attach a channel to sheet and initialize snapshot
- `GetDraftStatusUseCase`: read current draft status for a channel
- `PreparePickConfirmationUseCase`: validate pick intent and fetch card image data
- `ConfirmPickUseCase`: enforce turn/card validation and write pick
- `AnnounceNewPicksUseCase`: detect delta picks and produce announcement messages

### External

Location: `src/external`

- Implements application ports using external systems
- Current adapters:
  - `src/external/google-sheets/google-sheets-draft-repository.ts`
  - `src/external/sqlite/sqlite-draft-store.ts`
  - `src/external/discord/discord-member-resolver.ts`
  - `src/external/scryfall/scryfall-card-info.ts`
  - `src/external/scryfall/scryfall-client.ts`

### Interface (Discord)

Location: `src/interface/discord`

- Owns Discord transport concerns only:
  - client lifecycle
  - slash command registration
  - interaction dispatch
  - formatting replies/messages
- Command modules are split by concern:
  - `commands/draft-command.ts`
  - `commands/pick-command.ts`

## Runtime Composition

`DiscordBot` composes concrete adapters and use-cases in its constructor, then injects them through `CommandContext`.

1. Construct adapters (`external/*`)
2. Construct use-cases (`application/use-cases/*`)
3. Build command modules and `InteractionDispatcher`
4. Start poller and interaction listeners

This keeps wiring centralized while preserving dependency inversion in use-cases.

## Interaction Flow

### Slash Commands

1. Discord emits `interactionCreate`
2. `InteractionDispatcher` routes by command name/type
3. Command module translates transport input to use-case input
4. Use-case runs against ports
5. Command module formats Discord response

### Polling / Announcements

1. `IntervalPoller` ticks
2. `PickAnnouncementPollerService.poll()` loads all draft channels
3. `AnnounceNewPicksUseCase` computes new picks from snapshot delta
4. `DiscordBot` sends resulting messages per channel

## Dependency Direction

Allowed dependency direction:

- `interface -> application -> domain`
- `external -> application` (port implementations)
- `domain` depends on nothing outside itself

Avoid:

- `domain` importing from `application`, `external`, or `interface`
- `application` importing concrete implementations from `external`
- commands embedding business logic that belongs in use-cases

## File Map

- Entrypoint: `src/app.ts`
- Bot composition/root: `src/interface/discord/bot.ts`
- Domain rules/types: `src/domain/draft/*`
- Use-cases: `src/application/use-cases/*`
- Port contracts: `src/application/ports/*`
- Infrastructure/network adapters: `src/external/*`

