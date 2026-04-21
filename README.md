# Lens Map Card

A Home Assistant Lovelace card to display persons on a map based on configurable display rules.

## Features

- Display persons as markers on an interactive Leaflet map
- Configurable display rules for when each person is shown
- Default rule: distance < 1000m from current user
- Custom sensors per person
- Multiple map tile providers (OpenStreetMap, Stamen, CartoDB)
- Configurable zoom level and center
- Highly configurable through the UI editor

## Installation

### Manual

1. Download `home-assistant-lens-map-card.js` from the [releases](https://github.com/anomalyco/home-assistant-lens-map-card/releases)
2. Place it in your `www` folder
3. Reference it in your Lovelace configuration

### HACS

This card is available through HACS (Home Assistant Community Store).

## Configuration

### Basic Example

```yaml
type: custom:lens-map-card
title: Lens Map
persons:
  - entity_id: person.user1
  - entity_id: person.user2
current_user: person.user1
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
type: custom:lens-map-card
title: Family Map
show_title: true
current_user: person.dad
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
    displayRules:
      - sensor: distance
        operator: <
        value: "10000"
  - entity_id: person.kid
    name: Kid
    showOnMap: true
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
  api_key: YOUR_STADIA_API_KEY
zoom:
  level: 10
  auto_level: false
center:
  use_current_user: true
  entity_id: person.dad
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `type` | string | Required | `custom:lens-map-card` |
| `title` | string | `'Lens Map'` | Card title |
| `show_title` | boolean | `true` | Whether to show the title |
| `persons` | array | `[]` | List of persons to display |
| `current_user` | string | | Entity ID of the current user (used as reference for distance calculations) |
| `display_rules` | array | | Default display rules applied to all persons |
| `map` | object | | Map configuration |
| `zoom` | object | | Zoom settings |
| `center` | object | | Center settings |

### Person Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `entity_id` | string | Required | Person entity ID |
| `name` | string | | Custom display name |
| `namedSensors` | object | | Custom sensors for this person |
| `displayRules` | array | | Person-specific display rules |
| `showOnMap` | boolean | | Override to always/never show |

### Display Rule Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `id` | string | Unique rule ID |
| `priority` | number | `1` | Higher = evaluated first |
| `sensor` | string | `'distance'` | Sensor to check (`distance`, `state`, or custom sensor name) |
| `operator` | string | Required | Comparison operator (`<`, `<=`, `>`, `>=`, `=`, `!=`) |
| `value` | string | Required | Value to compare against |
| `enabled` | boolean | `true` | Whether rule is active |

### Map Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `type` | string | `'color'` | Map tile style (`bw`, `color`, `dark`, `outlines`, `system`) |
| `opacity` | number | `1` | Map layer opacity (0-1) |
| `api_key` | string | | API key for tile providers (e.g., Stadia Maps) |

### Map Types

- `bw`: Black & White (Stamen Toner)
- `color`: Color (OpenStreetMap)
- `dark`: Dark mode (CartoDB)
- `outlines`: Outlines only (Stamen Toner Lines)
- `system`: Auto-detect based on Home Assistant theme

### Zoom Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `level` | number | `10` | Zoom level (1-18, 10 ≈ 20km radius) |
| `auto_level` | boolean | `false` | Auto-adjust zoom to fit all persons |

### Zoom Levels (approximate radius)

| Level | Radius |
|-------|-------|
| 1 | ~20000km |
| 5 | ~1000km |
| 10 | ~20km |
| 13 | ~1km |
| 18 | ~0.5m |

### Center Options

| Option | Type | Default | Description |
|--------|------|--------|-------------|
| `use_current_user` | boolean | `true` | Center map on current user |
| `entity_id` | string | | Specific entity to center on |

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

The special `distance` sensor calculates the distance (in meters) from the person to the `current_user`. This uses the GPS coordinates from both entities.

Example rule: Show when within 1km:
```yaml
- sensor: distance
  operator: <
  value: "1000"
```

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