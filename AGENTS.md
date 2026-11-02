# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository.

## What this is

A Home Assistant dashboard plugin (a "Lovelace resource") that makes card hold actions run as
soon as the hold registers instead of when the finger lifts. Everything ships as one plain
ES2022 script: `hold-to-open.js`. There is no build step and there are no runtime dependencies.
Keep it that way.

## Layout

| Path                 | Purpose                                                                   |
| -------------------- | ------------------------------------------------------------------------- |
| `hold-to-open.js`    | The plugin. The only file users install.                                  |
| `tests/`             | Playwright tests (`*.spec.mjs`) and helpers.                              |
| `.hass/`             | Config for the disposable Home Assistant used by the tests.               |
| `docker-compose.yml` | Runs that Home Assistant, with this repo mounted at `/config/www/plugin`. |
| `scripts/`           | `record-demo.mjs` records `docs/demo.gif`.                                |
| `.github/workflows/` | Lint, tests, HACS validation, release.                                    |

## Commands

```sh
npm ci
npm run check        # eslint + prettier --check
npm run hass:up      # start the test Home Assistant on :8123 (HASS_PORT to change)
npm test             # Playwright (HASS_URL to point elsewhere)
npm run hass:down
```

Run `npm run check` and `npm test` before considering a change done. Behavior changes need a
test. Tests drive real touch events through the Chrome DevTools Protocol
(`tests/helpers/ha.mjs`), because Playwright's touchscreen API can only tap.

## How the plugin works

Home Assistant binds every card's tap/hold/double-tap handling to one shared `<action-handler>`
element in `document.body`. On `touchstart` it starts a timer; when the timer fires it sets
`held = true`, and only on `touchend` does it fire the card's `action` event with
`{ action: "hold" }`.

The plugin listens on `window` in the capture phase, so it runs before Home Assistant:

1. On `touchstart`, it finds the touched element that has `actionHandler.options.hasHold`, sets
   the shared `holdTime` from the options, and starts its own timer slightly after Home
   Assistant's.
2. When that fires and `held` is true (and `cancelled` isn't), it fires the `hold` action itself,
   shows the ghost, and marks the gesture as handled.
3. On the following `touchend`, it stops the event so Home Assistant doesn't also run a tap.

## Invariants (each one fixes a real problem, and each has a test)

- **Swallow the release after a hold we fired.** Otherwise lifting the finger runs the tap
  action too (for example, toggling the light whose details just opened).
- **End the card's press after swallowing the release.** A ripple waits for the click that
  follows a touch, and swallowing the release swallows that click, so the card would look
  pressed until it's tapped again. A `pointercancel` with the touch's pointer ID ends it.
- **Defer what needs a user interaction until the finger lifts.** A finger that's still down
  doesn't count as one. Android skips history entries added without one (so Back would leave
  the app instead of closing the dialog), and browsers block popups. So `pushState`, the
  `replaceState` calls after it, and `window.open` are held back and replayed on release, and
  Home Assistant's router is told to re-read the URL after a held navigation.
- **Rely on Home Assistant's own `held` and `cancelled` flags.** Don't reimplement movement or
  timing rules; matching Home Assistant keeps behavior consistent.
- **Fail safe.** If the internals the plugin reads are missing or change, do nothing, so Home
  Assistant's normal behavior remains. Never risk running an action twice.
- **Only dashboards, and details opened over one.** Touches outside `ha-panel-lovelace` are left
  alone, except in `ha-more-info-dialog` while a dashboard is showing, which uses that
  dashboard's options. Other dialogs, and details opened from settings pages, keep HA's
  behavior.
- **Listen for the release on the touched element too.** A touch's events keep going to the
  element first touched; when a hold in details replaces it, they stop reaching `window`, so
  the release wouldn't be swallowed and held-back history calls would never be replayed.
- **A member's details are a second `ha-more-info-dialog`, stacked on the group's.** HA's own
  dialog swaps its contents, so the group's would vanish. The plugin creates the second dialog
  itself, keeps its `hass` current, and stops its `dialog-closed` so HA's dialog manager never
  sees it.
- **Each stacked dialog has its own history entry, and every way out removes it.** HA's
  popstate listeners were added before the plugin's, so they can't be pre-empted. On landing on
  a dialog's entry they go back once more (closing the group) and reopen the details named in
  the URL. So `history.back()` ignores calls made during a popstate while a stacked dialog is
  open or the plugin is going back, and `fromUrl` `hass-more-info` events are dropped meanwhile.
  The X or a swipe down goes back once itself. Dialogs leave the stack as soon as they start
  closing, so HA can go back through the group's entry when the group closes.
- **While calls are held back, `history.state` reports the held-back push.** HA replaces the URL
  right after pushing a dialog's entry, passing on `history.state`; otherwise the dashboard's
  state would land on the dialog's entry.
- **In details, the ghost is a popover in the dialog's root.** With `stack_details: false`, a
  member's details replace the group's a moment after the hold, removing the card, and the
  dialog cancels animations inside it.

## Conventions

- Prettier formatting (100 columns), ESLint recommended rules.
- Keep comments concise. A comment should explain why the code is written the way it is, not
  repeat what the code does (unless that's unobvious). If code doesn't need a comment, don't
  write one.
- [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`, ...).
- Update `CHANGELOG.md` under _Unreleased_ for user-visible changes.
- Don't add dependencies to the plugin. Dev dependencies need a good reason.
