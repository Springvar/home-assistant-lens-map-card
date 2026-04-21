# Test Page

## Usage

1. Build the card (for editor.html/card.html):
   ```bash
   npm run build
   ```

2. Start the dev server:
   ```bash
   npm run dev
   ```
   This will automatically open the test page in your browser at `http://localhost:5173/test/combined.html`

## Test Pages

- **combined.html** - Editor + Card side by side (default, opens automatically)
- **editor.html** - Editor only (http://localhost:5173/test/editor.html)
- **card.html** - Card only (http://localhost:5173/test/card.html)

## Configuration

The test pages load configuration from YAML files:

- **Default**: `config.yaml` - Basic configuration with sample persons
- **Custom**: Create additional YAML files and load them with `?config=filename` (without .yaml extension)

Example: `http://localhost:5173/test/card.html?config=myconfig` loads `myconfig.yaml`

## Dummy Data

The test page includes mock Home Assistant data:
- Person entities (John, Jane, Bob, Alice) with GPS coordinates
- Zone entities (home, office, gym)
- Home Assistant theming variables

You can modify the dummy data directly in the HTML files for testing different scenarios.