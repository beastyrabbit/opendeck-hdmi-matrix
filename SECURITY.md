# Security policy

## Supported versions

Security fixes are provided for the latest published release.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Include the affected version, a minimal reproduction and the impact you observed. Do not open a public issue for an unpatched vulnerability.

You should receive an acknowledgement within seven days. A fix timeline depends on severity and whether the affected behavior belongs to this plugin, OpenDeck or the matrix firmware.

## Network boundary

The tested HDCVT matrix accepts unauthenticated HTTP control commands. Keep the device and the computer running OpenDeck on a trusted local network. This plugin does not add authentication to the matrix firmware.
