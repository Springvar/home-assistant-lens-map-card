---
name: lens-map-card
description: Home Assistant HACS Lovelace card development
---

## Project Overview

- **Type**: Home Assistant Lovelace HACS card
- **Framework**: Lit web components
- **Build**: Rollup with terser minification
- **Test**: Vitest with jsdom environment

## Key Files

- `src/lens-map-card.ts` - Main card component
- `src/lens-map-card-editor.ts` - UI editor for card configuration
- `src/types.ts` - TypeScript type definitions
- `src/lens-map-card.test.ts` - Unit tests
- `hacs.json` - HACS manifest

## Architecture

The card extends Lit's `LitElement` and uses:
- Leaflet.js for map rendering
- Home Assistant entity state API
- Configurable display rules for showing/hiding person markers

## Configuration Schema

```yaml
type: custom:lens-map-card
title: string
show_title: boolean
current_user: entity_id
persons:
  - entity_id: string
    name: string
    displayRules: array
map:
  type: bw | color | dark | outlines | system
zoom:
  level: number (1-18)
```

## Commands

```bash
npm ci        # Install deps
npm run build # Build for release
npm run dev   # Watch mode
npm test     # Run tests
```