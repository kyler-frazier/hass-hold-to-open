# Contributing

Thanks for helping out! Bug reports, ideas and pull requests are all welcome.

## Reporting bugs

Please use the [bug report form](https://github.com/kyler-frazier/hass-hold-to-open/issues/new/choose)
and include your Home Assistant version, device and browser or app, and the relevant part of your
dashboard configuration. A short screen recording helps a lot.

## Using AI tools

AI tools are welcome here: this project itself is written with AI assistance. What matters is
that a person stands behind every contribution.

- **Disclose it.** If AI helped with a pull request, say which tool and roughly how much in the
  pull request description.
- **Understand it.** You should be able to explain every change you submit and how it fits the
  rest of the plugin without the AI's help.
- **Verify it.** Run the tests, and try changes on a real touch device. For bug reports,
  reproduce the problem yourself.
- **Edit it.** AI-written issues and descriptions tend to be long and padded. Trim them to what a
  maintainer needs to know.

Contributions that don't meet this bar may be closed without detailed review.

## Development setup

Requirements: Node.js 22+ and Docker.

```sh
npm ci
npx playwright install chromium
npm run hass:up   # disposable Home Assistant at http://localhost:8123 (user: test / test)
```

This repo is mounted straight into that Home Assistant, so after editing
`hold-to-open.js` just reload the page. Test dashboards live in
`.hass/config/dashboards/`. Use Chrome DevTools' device mode (with touch emulation) to try holds with a mouse.

If port 8123 is taken (for example by your own Home Assistant), run
`HASS_PORT=8124 npm run hass:up` and `HASS_URL=http://localhost:8124 npm test`.

## Before opening a pull request

```sh
npm run check   # lint + formatting
npm test        # Playwright suite (needs `npm run hass:up`)
```

- Add or update tests for behavior changes. See `tests/helpers/ha.mjs` for touch helpers.
- Add a line to `CHANGELOG.md` under _Unreleased_.
- Use [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

[AGENTS.md](AGENTS.md) describes how the plugin works and the invariants changes must keep.

## Releasing (maintainers)

1. Move the _Unreleased_ changelog entries under a new version heading.
2. Create a GitHub release with a `vX.Y.Z` tag. The release workflow stamps the version into
   the script and attaches it to the release, which is what HACS installs.
