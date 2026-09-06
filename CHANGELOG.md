# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

## [0.3.3-pre] - 2026-09-06

### Fixed

- **Trail history "Request error"** - Replaced the REST `callApi` history fetch with the WebSocket `history/history_during_period` API (`hass.callWS`), eliminating the residual `{error: 'Request error'}` failures on Home Assistant versions where the REST history endpoint is unavailable or rejects requests. Trail points now come from the compact `{s, a, lc, lu}` shape.
- **Staleness now uses `last_updated`** - A person's age is measured from the entity's `last_updated` (which refreshes on attribute-only GPS updates) with a `last_changed` fallback, instead of `last_changed`. This matches Home Assistant's own history behavior so stale detection works even when the state value doesn't change. Applies to both the "Show as stale" markers and the `data_age` sensor.
- **Stale styling on overlay toggles** - The person toggle buttons in the top-right overlay now also dim and grayscale when their person is stale, matching the map marker treatment.

## [0.3.2-pre] - 2026-09-06

### Added

- **Stale-person detection** - Mark a person as "stale" when their location hasn't updated within `stale_after_hours` (default: disabled). Stale markers are dimmed and shown in grayscale, and staleness is re-evaluated once a minute automatically. A missing entity or timestamp is always treated as stale.
- **`data_age` built-in sensor** - Age (in **minutes**) of a person's last location update, usable in display conditions (e.g. `sensor: data_age, comparator: gt, value: 1440` hides a person last updated more than 24h ago).
- **"Show as stale" editor setting** - Configure stale detection in the card editor under *Display Conditions*, with a threshold slider (1-72 hours).

### Fixed

- **Trail history 401** - `_fetchTrailHistory` now uses `hass.callApi` instead of reading a manually-built `Authorization` header that relied on the obsolete `hass.auth.access_token`, which caused unauthorized (HTTP 401) responses when fetching trail history on current Home Assistant versions. Removed leftover debug logging from history fetch.

## [0.3.1-pre] - 2026-09-06

### Changed

- Restyled the card editor to match the flightradar24-card design language.

## [0.3.0] - 2026-09-03

### Added

- History trail with configurable opacity, age, proximity, and distance filters
- Per-person trail color picker
- Multiple map tile providers (OpenStreetMap, CartoDB, Stadia, Esri, OpenTopoMap) with theme-aware `system` mode

### Changed

- Corrected repository metadata after the GitHub rename.