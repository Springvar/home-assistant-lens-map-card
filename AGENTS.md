# AGENTS.md

## Developer Commands

| Command | Description |
|---------|-------------|
| `npm ci` | Install dependencies |
| `npm run build` | Build with Rollup (outputs minified to `dist/home-assistant-lens-map-card.js`) |
| `npm run dev` | Vite dev server for local testing |
| `npm test` | Run Vitest tests |
| `npm run test:watch` | Watch mode for tests |

## Project Structure

- **Entry point**: `src/lens-map-card.ts`
- **Editor**: `src/lens-map-card-editor.ts`
- **Types**: `src/types.ts`
- **Tests**: `src/**/*.test.ts`
- **Build output**: `dist/home-assistant-lens-map-card.js`

## Tooling

- **Build**: Rollup + terser (minified output)
- **Test**: Vitest with jsdom environment
- **TypeScript**: Strict mode enabled
- **Node**: v20 (per CI)

## CI Pipeline

- **validate.yml**: Runs `npm test` then `npm run build`
- **build.yml**: Builds and uploads `dist/` as artifact
- **release.yml**: Creates HACS-compatible zip on GitHub release

## Test Pages

Local browser testing via Vite dev server:

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server (opens combined.html) |

Test pages in `test/`:
- `combined.html` - Editor + Card side by side
- `editor.html` - Editor only
- `card.html` - Card only

Load custom configs: `?config=filename` (without .yaml)

## GitHub Actions CI

After push to main, two workflows run:

1. **Validate** - Runs tests then build (`npm test` → `npm run build`)
2. **Build** - Builds and uploads `dist/` artifact

Check status: https://github.com/Springvar/home-assistant-lens-map-card/actions

## Development Workflow

1. Make changes
2. Run `npm test && npm run build` locally
3. Commit and push
4. Wait for GitHub Actions to pass
5. If failed, fix and repeat

## Notes

- No separate lint/typecheck scripts - CI just runs test then build
- Rollup config uses `@rollup/plugin-node-resolve` with `exportConditions: ['dom', 'module']`
- Tests use jsdom environment and globals: true
