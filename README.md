# HDMI Matrix for OpenDeck

<img src="plugin/icons/plugin.svg" width="128" alt="HDMI Matrix plugin icon">

Local Stream Deck control for an HDCVT HDMI matrix. The plugin shows only connected outputs, active inputs and renamed presets. Pick an output, then pick an input to route it.

The included profile is designed for an 8 by 4 Stream Deck XL:

![HDMI Matrix profile preview](assets/preview.png)

```text
Outputs
Presets
Back | selected output | ARC | mute | stream | · | · | refresh
Inputs
```

## Features

- Routes any active input to the selected output
- Shows port names from the matrix
- Hides inputs without a signal and outputs without a connected display
- Recalls renamed presets while hiding untouched factory presets
- Controls ARC, audio mute and HDMI output streaming
- Uses output streaming as a practical disconnect switch
- Polls the matrix locally without a cloud service

## Compatibility

| Device | Status |
| --- | --- |
| HDCVT `HDP-MXC88A`, 8 by 8, 18 Gbps | Tested |
| Rebranded 8 by 8 matrices with the same HDCVT web firmware | May work, not tested |
| Other HDMI matrices | Not supported unless they implement the same HTTP API |

Development and daily use were tested with matrix firmware `V1.00.19`, web firmware `V2.00.22` and OpenDeck `2.14.0`.

The model name alone is not enough for an untested device. This plugin expects `POST /cgi-bin/instr` and these JSON commands:

- `get input status`
- `get output status`
- `get video status`
- `video switch`
- `preset set`
- `set arc`
- `set output audio mute`
- `tx stream`

You can check the model and firmware without changing anything:

```bash
curl -s http://MATRIX-IP/cgi-bin/instr \
  -H 'Content-Type: application/json' \
  -d '{"comhead":"get status","language":0}'
```

A known compatible response contains `"model":"HDP-MXC88A"`. If another model returns the same status shapes and commands, open an issue with its model and firmware so it can be added to the compatibility table.

The bundled profile assumes 32 keys. Smaller decks and 4 by 4 matrices have not been tested.

## Installation

Requirements:

- OpenDeck with the bundled Starter Pack plugin
- Node.js 20 or newer for the one-time profile setup
- The matrix and computer on the same local network

1. Download `de.beasty.hdmi-matrix.streamDeckPlugin` from the [latest GitHub release](https://github.com/beastyrabbit/opendeck-hdmi-matrix/releases/latest).
2. Install it from OpenDeck's plugin manager.
3. Quit OpenDeck completely.
4. Run the setup command for your platform and replace `MATRIX-IP` with the matrix address.

Linux:

```bash
node ~/.config/opendeck/plugins/de.beasty.hdmi-matrix.sdPlugin/setup-opendeck.mjs \
  --matrix-url http://MATRIX-IP
```

macOS:

```bash
node "$HOME/Library/Application Support/opendeck/plugins/de.beasty.hdmi-matrix.sdPlugin/setup-opendeck.mjs" \
  --matrix-url http://MATRIX-IP
```

Windows PowerShell:

```powershell
node "$env:APPDATA\opendeck\plugins\de.beasty.hdmi-matrix.sdPlugin\setup-opendeck.mjs" `
  --matrix-url http://MATRIX-IP
```

5. Start OpenDeck. The setup creates the `HDMI Matrix` profile and adds a launcher to the first free key in `Default`.

For a Flatpak installation, pass its configuration directory explicitly:

```bash
node ~/.var/app/me.amankhanna.opendeck/config/opendeck/plugins/de.beasty.hdmi-matrix.sdPlugin/setup-opendeck.mjs \
  --config ~/.var/app/me.amankhanna.opendeck/config/opendeck \
  --matrix-url http://MATRIX-IP
```

Custom profile names are supported:

```bash
node setup-opendeck.mjs \
  --matrix-profile "Matrix" \
  --return-profile "My main profile" \
  --matrix-url http://MATRIX-IP
```

Quit OpenDeck before running the setup. On Linux, the script refuses to edit profiles while OpenDeck is running. It also backs up an existing profile before replacing an incompatible Matrix layout.

## Use

Press the launcher in the main profile. In the Matrix profile, select an output in the top row and an input in the bottom row. The route changes immediately.

ARC, mute and stream always control the amber selected output. Turning stream off disables that HDMI output while retaining its last input mapping. Turning it on restores the output with the same mapping.

## Build from source

```bash
pnpm install
pnpm verify
```

The build writes the plugin bundle, setup script and installable package to `dist/`. Tests use a local HTTP mock and never change a real matrix route.

## OpenAction Marketplace

The OpenDeck plugin store reads the [OpenAction plugin registry](https://github.com/OpenActionAPI/plugins). A marketplace submission needs:

1. A public GitHub repository with the `openaction` topic
2. A GitHub release containing one `.streamDeckPlugin` asset
3. An entry for `de.beasty.hdmi-matrix` in the registry's `catalogue.json`
4. A matching high-resolution icon named `de.beasty.hdmi-matrix.png`
5. A pull request to the registry repository

The catalogue `name` and `author` must exactly match `plugin/manifest.json`. OpenDeck then finds the newest non-prerelease GitHub release and installs its `.streamDeckPlugin` asset.

## License

[MIT](LICENSE). This project is not affiliated with HDCVT, OpenDeck or Elgato.
