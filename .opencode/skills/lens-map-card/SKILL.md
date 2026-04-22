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
npm run dev   # Vite dev server (opens test pages)
npm test      # Run tests
```

## GitHub Actions CI

After each push, two workflows run on the `main` branch:

1. **Validate** - Runs tests then build:
   ```bash
   npm test
   npm run build
   ```

2. **Build** - Builds and uploads `dist/` artifact

### Monitoring Actions

Using GitHub CLI (`gh`):
```bash
gh run list --limit 5          # List recent runs
gh run watch <run-id>          # Wait for completion
gh run view <run-id>           # Get run details
```

Manual check: https://github.com/Springvar/home-assistant-lens-map-card/actions

## Development Workflow

1. Make changes locally
2. Run tests: `npm test`
3. Run build: `npm run build`
4. Commit and push
5. Wait for GitHub Actions to pass
6. If failed, fix locally and repeat