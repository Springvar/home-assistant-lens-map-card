# Whereabouts Map Card

A Home Assistant Lovelace card to display persons on a map based on configurable display rules. This is a companion card to the **whereabouts-card**.

> **Renamed:** this card was previously published as **Lens Map Card** / `custom:lens-map-card`. It is now registered as `custom:whereabouts-map-card`. Existing dashboards using `custom:lens-map-card` keep working via a backwards-compatible alias.

## Features

- Display persons as markers on an interactive Leaflet map
- Configurable display rules for when each person is shown
- Default rule: distance < 1000m from current user
- Custom sensors per person
- History trail with configurable opacity, age, proximity, and distance filters
- Per-person trail color picker
- Multiple map tile providers (OpenStreetMap, CartoDB, Stadia, Esri, OpenTopoMap)
- Configurable zoom level, auto zoom, and center
- Overlay controls: auto-zoom toggle and per-person visibility toggle buttons
- Auto-detect current user from `hass.user.id`
- Highly configurable through the UI editor

## Installation

### HACS

This card is available through HACS. Add this repository as a custom repository in HACS.

### Manual

1. Download `home-assistant-whereabouts-map-card.js` from the [releases](https://github.com/Springvar/home-assistant-whereabouts-map-card/releases)
2. Place it in your `www` folder
3. Reference it in your Lovelace configuration

## Configuration

### Basic Example

```yaml
type: custom:whereabouts-map-card
title: Whereabouts Map
persons:
  - entity_id: person.user1
  - entity_id: person.user2
display_rules:
  - sensor: distance
    operator: <
    value: "1000"
map:
  type: color
zoom:
  level: 10
```

### Full Configuration

```yaml
type: custom:whereabouts-map-card
title: Family Map
show_title: true
persons:
  - entity_id: person.dad
    name: Dad
    namedSensors:
      phone_battery:
        entity_id: sensor.dad_phone_battery
    displayRules:
      - sensor: distance
        operator: <
        value: "5000"
  - entity_id: person.mom
    name: Mom
  - entity_id: person.kid
    name: Kid
display_rules:
  - id: default
    priority: 1
    sensor: distance
    operator: <
    value: "1000"
    enabled: true
map:
  type: dark
  opacity: 0.8
  interactive: true
  api_key: YOUR_STADIA_API_KEY
zoom:
  level: 10
  auto_level: false
center:
  type: visible
trail:
  enabled: true
  max_age: 60
  max_distance: 5000
  proximity: 50
  newest_opacity: 1
  oldest_opacity: 0.3
  midpoint: 50
  colors:
    person.dad: "#e6194b"
    person.mom: "#3cb44b"
show_auto_zoom: true
show_toggle_buttons: true
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `type` | string | Required | `custom:whereabouts-map-card` |
| `title` | string | `'Whereabouts Map'` | Card title |
| `show_title` | boolean | `true` | Whether to show the title |
| `persons` | array | `[]` | List of persons to display |
| `current_user` | string | auto-detected | Entity ID of the current user (used as reference for distance calculations; auto-detected from `hass.user.id` if not set) |
| `display_rules` | array | | Default display rules applied to all persons |
| `map` | object | | Map configuration |
| `zoom` | object | | Zoom settings |
| `center` | object | | Center settings |
| `trail` | object | | History trail settings |
| `show_auto_zoom` | boolean | `true` | Show auto-zoom button in overlay |
| `show_toggle_buttons` | boolean | `true` | Show per-person toggle buttons in overlay |

### Person Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `entity_id` | string | Required | Person entity ID |
| `name` | string | | Custom display name |
| `namedSensors` | object | | Custom sensors for this person (to use in display rules) |
| `displayRules` | array | | Person-specific display rules (overrides default) |
| `showOnMap` | boolean | | Show on map regardless of display rules |

### Display Rule Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `id` | string | Unique | Rule ID |
| `priority` | number | `1` | Higher = evaluated first |
| `sensor` | string | `'distance'` | Sensor to check (`distance`, `state`, or custom sensor name) |
| `operator` | string | Required | Comparison operator (`<`, `<=`, `>`, `>=`, `=`, `!=`, `oneOf`) |
| `value` | string | Required | Value to compare against |
| `enabled` | boolean | `true` | Whether rule is active |

### Map Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `type` | string | `'color'` | Map tile style (`none`, `system`, or a provider below) |
| `light` | string | `'color'` | Map used for **light themes** when `type: system` |
| `dark` | string | `'dark'` | Map used for **dark themes** when `type: system` |
| `opacity` | number | `1` | Map layer opacity (0-1) |
| `api_key` | string | | API key for keyed providers (CARTO/Stadia) |
| `light_api_key` | string | | API key for the `light` theme map when `type: system` |
| `dark_api_key` | string | | API key for the `dark` theme map when `type: system` |
| `interactive` | boolean | `true` | Enable map interactivity (zoom, pan, scroll) |

### Map Types

Keyless providers work out of the box; keyed providers require a **per-user API key**
(no shared key is shipped — each user creates their own and enters it in the card editor).

| Value | Description |
|-------|-------------|
| `none` | No tile layer |
| `system` | Auto-detect dark/light based on Home Assistant theme — optionally pick a different map per theme via `light`/`dark` |
| `color` | Color (OpenStreetMap) — no key |
| `satellite` | Satellite (Esri) — no key |
| `topo` | Topographic (OpenTopoMap) — no key |
| `light` | Light (CARTO) — requires a [CARTO key](https://carto.com/basemaps/apikey) |
| `dark` | Dark (CARTO) — requires a [CARTO key](https://carto.com/basemaps/apikey) |
| `voyager` | Voyager (CARTO) — requires a [CARTO key](https://carto.com/basemaps/apikey) |
| `bw` | Black & White (Stadia Toner) — requires a [Stadia key](https://stadiamaps.com/) |
| `outlines` | Outlines only (Stadia Toner Lines) — requires a [Stadia key](https://stadiamaps.com/) |

CARTO keys are appended as `?key=`, Stadia keys as `?api_key=`.

### Zoom Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `level` | number | `10` | Zoom level (1-18) |
| `auto_level` | boolean | `false` | Auto-adjust zoom to fit all visible persons |

### Center Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `type` | string | `'user'` | Center type: `user`, `visible`, `home`, `fixed`, or `person:<entity_id>` |
| `home_zone` | string | | Zone entity ID for `home` center type |
| `fixed_coordinates` | object | | `{ lat, lon }` for `fixed` center type |

Center types:
- `user` — Centers on the current logged-in user
- `visible` — Centers on the centroid of all visible persons; with auto zoom uses `fitBounds`
- `home` — Centers on a specified home zone
- `fixed` — Centers on specified coordinates
- `person:<entity_id>` — Centers on a specific person

### Trail Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `enabled` | boolean | `false` | Enable history trail |
| `max_age` | number | `60` | Maximum history age in minutes |
| `max_distance` | number | | Maximum trail distance from current user in meters (0 or unset = use display rule threshold) |
| `proximity` | number | `50` | Hide trail points within this many meters of the person's current position |
| `newest_opacity` | number | `1` | Opacity of newest trail points (0-1) |
| `oldest_opacity` | number | `0.3` | Opacity of oldest trail points (0-1) |
| `midpoint` | number | `50` | Opacity fade curve offset (0=steep then slow, 100=slow then steep) |
| `colors` | object | | Per-person trail color overrides by entity_id (e.g., `{ "person.dad": "#e6194b" }`) |

Trail colors are auto-assigned from a 20-color palette if not overridden per person.

## Sensors

You can define custom sensors per person to use in display rules:

```yaml
persons:
  - entity_id: person.user1
    namedSensors:
      battery:
        entity_id: sensor.user1_battery
      work_state:
        entity_id: binary_sensor.at_work
```

Then use them in display rules:

```yaml
display_rules:
  - sensor: battery
    operator: >
    value: "20"
  - sensor: work_state
    operator: =
    value: "on"
```

## Distance Sensor

The special `distance` sensor calculates the distance (in meters) from the person to the current user. This uses the GPS coordinates from both entities.

Example rule: Show when within 1km:
```yaml
- sensor: distance
  operator: <
  value: "1000"
```

## Overlay

When `show_auto_zoom` or `show_toggle_buttons` is enabled, an overlay appears in the top-right corner of the map:
- **Auto zoom button** — Re-centers and zooms the map to fit all currently visible persons
- **Per-person toggle buttons** — Show/hide individual persons on the map

## Development

```bash
# Install dependencies
npm ci

# Build
npm run build

# Watch mode
npm run dev

# Run tests
npm test
```

## License

MIT
