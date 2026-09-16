# Contributing

Small, focused fixes and compatibility reports are welcome. Open an issue before a large behavior or profile-layout change so the expected hardware and OpenDeck behavior are clear.

## Development

Use Node.js 20 or newer and pnpm 11.3.0.

```bash
pnpm install --frozen-lockfile
pnpm verify
```

Tests use local fixtures and mocks. Do not point automated tests at a real matrix because routing commands change live outputs.

Keep hardware claims tied to a model, matrix firmware version, web firmware version, OpenDeck version and the platform you actually tested. CI coverage alone is not an end-to-end support claim.

## Pull requests

- Keep the diff limited to one problem.
- Add a regression test for behavior changes when practical.
- Run `pnpm verify` before submitting.
- Explain any user-facing change and manual hardware check in the pull request.
- Do not commit Matrix URLs, local OpenDeck profiles, credentials or generated release archives.

AI-assisted changes are allowed, but disclose the assistance in the pull request. You are responsible for understanding the submitted code, checking every claim and answering maintainer questions yourself. Do not submit generated text or code that you have not verified.
