# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

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