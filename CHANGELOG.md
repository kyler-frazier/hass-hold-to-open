# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.1] - 2026-10-16

### Fixed

- Closing details opened by a hold with the X button no longer reopens them.
- Navigate hold actions now go to their page. They run when the finger lifts.
- Url hold actions open their link when the finger lifts, so the browser doesn't block it as a popup.

## [0.1.0] - 2026-10-15

### Added

- Dashboard hold actions run as soon as the hold registers, without waiting for release.
- The release after a hold no longer counts as a tap.
- The Back gesture closes dialogs opened by a hold (the history entry is added once the finger
  lifts, so Android doesn't skip it).
- A fading "ghost" of the card when the hold registers.
- Options: `enable`, `hold_time`, `ghost`, `ghost_opacity`, `ghost_scale` and `ghost_duration`.

[Unreleased]: https://github.com/kyler-frazier/hass-hold-to-open/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/kyler-frazier/hass-hold-to-open/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kyler-frazier/hass-hold-to-open/releases/tag/v0.1.0
