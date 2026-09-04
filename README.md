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

Development and daily use were tested on Linux with matrix firmware `V1.00.19`, web firmware `V2.00.22`, OpenDeck `2.14.0` and a physical Stream Deck XL.

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

- OpenDeck
- Node.js 20 or newer while the plugin is running and for profile setup
- OpenDeck's bundled Starter Pack plugin, which provides profile switching
- The matrix and computer on the same local network

1. Download `com.beastyrabbit.hdmi-matrix.streamDeckPlugin` from the [latest GitHub release](https://github.com/beastyrabbit/opendeck-hdmi-matrix/releases/latest).
2. Install it from OpenDeck's plugin manager.
3. Quit OpenDeck completely.
4. Run the setup command for your platform.

Linux:

```bash
node ~/.config/opendeck/plugins/com.beastyrabbit.hdmi-matrix.sdPlugin/setup-opendeck.mjs
```

macOS:

```bash
node "$HOME/Library/Application Support/opendeck/plugins/com.beastyrabbit.hdmi-matrix.sdPlugin/setup-opendeck.mjs" \
  --confirm-opendeck-closed
```

Windows PowerShell:

```powershell
node "$env:APPDATA\opendeck\plugins\com.beastyrabbit.hdmi-matrix.sdPlugin\setup-opendeck.mjs" `
  --confirm-opendeck-closed
```

5. Start OpenDeck. The setup creates the managed Matrix control profile and adds the HDMI Matrix launcher to the first free key in `Default`.
6. Select the launcher in OpenDeck. Enter the address of the web interface under `Matrix URL`, then press `Save connection`.

The launcher is the only button users configure. OpenDeck stores its address as a global plugin setting, so the managed control buttons need no setup. The build and setup scripts never contain or write the address.

OpenDeck installs the plugin archive but cannot create this plugin's managed 32-key profile. The terminal setup in step 4 is therefore required once after installation. Running it again updates the managed plugin files and profile. It refuses to replace profiles or launchers it cannot identify as belonging to this plugin.

For a Flatpak installation, pass its configuration directory explicitly:

```bash
node ~/.var/app/me.amankhanna.opendeck/config/opendeck/plugins/com.beastyrabbit.hdmi-matrix.sdPlugin/setup-opendeck.mjs \
  --config ~/.var/app/me.amankhanna.opendeck/config/opendeck
```

The Flatpak path is provided for testing and is not part of the end-to-end support claim yet. The sandbox must be able to run Node.js and reach the matrix on the local network.

Custom profile names are supported:

```bash
node setup-opendeck.mjs \
  --matrix-profile "Matrix" \
  --return-profile "My main profile"
```

Profile names may contain letters, numbers, underscores and spaces, with one optional folder separated by `/`. Other characters conflict with OpenDeck's generated action contexts and are rejected by the setup script.

If the Matrix profile name changes on a later setup run, the generated profile is migrated to the new name. The previous managed profile file is backed up first; unrelated user profiles are never migrated.

Quit OpenDeck before running the setup. It checks for a running OpenDeck process before changing plugin or profile files. It also keeps timestamped backups when it updates managed profile data. If setup reports an interrupted write, leave OpenDeck closed and restore the newest `.backup-*` file before trying again.

Pre-release builds used the old `de.beasty.hdmi-matrix` bundle ID. The setup script recognizes their managed profiles, but it does not delete the old plugin directory. Testers who installed one should remove that old entry after the new plugin works.

### Platform status

| Platform | Current coverage |
| --- | --- |
| Linux | OpenDeck, setup, Property Inspector and physical Stream Deck XL tested end to end |
| Windows | Automated tests and build only; OpenDeck installation and physical keys not yet tested |
| macOS | Automated tests and build only; OpenDeck installation and physical keys not yet tested |
| Flatpak | Explicit config path documented; sandbox behavior not yet tested end to end |

## Use

Press the launcher on the physical Stream Deck. In OpenDeck's editor, double-click the launcher to simulate a physical press; a single click only opens its settings. In the Matrix profile, select an output in the top row and an input in the bottom row. The route changes immediately.

ARC, mute and stream always control the amber selected output. Turning stream off disables that HDMI output while retaining its last input mapping. Turning it on restores the output with the same mapping.

## How it works

The setup script writes a managed 32-key OpenDeck profile and places one HDMI Matrix launcher in the main profile. The launcher holds the connection settings and opens the controls. The launcher and back key use OpenDeck's bundled profile-switch action because OpenDeck only permits that built-in action to change profiles. Their targets and all internal Matrix buttons are generated automatically; users configure only the launcher's Matrix URL.

When the Matrix profile becomes visible, the plugin reads three status records from `POST /cgi-bin/instr`: inputs, outputs and video routing. It uses those records to draw every key. Disconnected outputs, inputs without a signal and factory-named presets render as blank keys. The plugin repeats the status read every four seconds and after each button press.

Output selection is local to each Stream Deck. Pressing an active output marks it amber without changing a route. Pressing an input then sends `video switch` with the selected output and input port. Presets send `preset set`. ARC, mute and stream read the current value first and send the inverse value for the selected output.

The Matrix URL comes only from the launcher's OpenDeck settings panel. The property inspector saves it through the OpenAction `setGlobalSettings` event. The plugin receives the setting, creates the local HTTP client and refreshes the visible keys. No cloud service or external server takes part.

The tested matrix exposes an unauthenticated HTTP control API. Keep it on a trusted local network and do not expose it to the internet. Anyone who can reach that API can change routes and output state.

The matrix accepts one command at a time, so the plugin serializes all HTTP requests. A request times out after three seconds. Invalid JSON is retried twice because this firmware occasionally returns an incomplete response.

## Build from source

```bash
pnpm install
pnpm verify
```

The build writes the plugin bundle, setup script and installable package to `dist/`. Tests use a local HTTP mock and never change a real matrix route.

### Local deployment on Linux

During development, this command handles the complete local update:

```bash
pnpm deploy
```

It builds the plugin, stops a running OpenDeck process, installs the new build, updates the Matrix profile and starts OpenDeck again with its previous command-line arguments. OpenDeck keeps the Matrix URL in its global plugin settings, outside the plugin directory, so local deployments do not overwrite it. If OpenDeck was already stopped, the command leaves it stopped.

Pass profile setup options after `--`:

```bash
pnpm deploy -- --matrix-profile "Matrix" --return-profile "Studio"
```

Preview the operation without stopping or changing OpenDeck:

```bash
pnpm deploy -- --dry-run
```

The dry run still refreshes the local `dist/` build. Automatic process restart is Linux-only. On macOS and Windows, use `pnpm build`, quit OpenDeck and run the bundled setup script manually.

The checked-in `t3.json` exposes setup, verification, build and local deployment in T3 Code's project scripts menu. Its **In OpenDeck deployen** entry runs the same `pnpm deploy` command.

### GitHub release deployment

The release workflow checks the tag against `plugin/manifest.json`, verifies the package and publishes the installable `.streamDeckPlugin` together with checksums. See the workflow file for the exact release gate.

## OpenAction Marketplace

The OpenDeck plugin store reads the [OpenAction plugin registry](https://github.com/OpenActionAPI/plugins). A marketplace submission needs:

1. A public GitHub repository with the `openaction` topic
2. A GitHub release containing one `.streamDeckPlugin` asset
3. An entry for `com.beastyrabbit.hdmi-matrix` in the registry's `catalogue.json`
4. A matching high-resolution icon named `com.beastyrabbit.hdmi-matrix.png`
5. A pull request to the registry repository

The catalogue `name` and `author` must exactly match `plugin/manifest.json`. OpenDeck then finds the newest non-prerelease GitHub release and installs its `.streamDeckPlugin` asset. The registry also accepts an issue containing the public repository URL if a focused catalogue pull request is not practical.

## Known limitations

- The managed profile needs a 32-key Stream Deck XL.
- The profile stays open until the Back key is pressed. Automatic return after inactivity is tracked in [issue #1](https://github.com/beastyrabbit/opendeck-hdmi-matrix/issues/1) for a later release.
- Marketplace installation still requires the one-time terminal setup described above.

## License

[MIT](LICENSE). This project is not affiliated with HDCVT, OpenDeck or Elgato.
