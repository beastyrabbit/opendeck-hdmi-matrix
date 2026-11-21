# Changelog

All notable changes to this project are recorded here.

## 0.1.0 - 2026-11-21

First public release.

### Added

- A generated 32-key Stream Deck XL profile for an HDCVT HDP-MXC88A HDMI matrix.
- Routing for active inputs and outputs, renamed presets, ARC, audio mute and output streaming.
- A Property Inspector for the Matrix URL and a managed profile setup script.
- Linux local deployment plus portable verification on Linux, Windows and macOS.

### Safety and packaging

- Setup refuses unsafe paths and unmanaged profile collisions and uses recoverable file replacement.
- Matrix responses are bounded and validated before they reach the renderer.
- The release package includes project and dependency license notices, package checks and checksums.
- Release builds use read-only repository access; a separate publisher verifies a draft before publication.
- Public assets include `SHA256SUMS` and GitHub build-provenance attestations. Releases require successful CI on the tagged commit and repository release immutability.

### Known limitations

- End-to-end OpenDeck and physical-device testing currently covers Linux and a Stream Deck XL.
- Installation requires one terminal setup command after OpenDeck installs the plugin.
- Automatic return after inactivity remains blocked by OpenDeck's restriction on third-party profile switching in issue #1; it is excluded from 0.1.0.
