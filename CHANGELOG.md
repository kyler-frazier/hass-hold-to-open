# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Dashboard hold actions run as soon as the hold registers, without waiting for release.
- The release after a hold no longer counts as a tap.
- The Back gesture closes dialogs opened by a hold (the history entry is added once the finger
  lifts, so Android doesn't skip it).
- A fading "ghost" of the card when the hold registers.
- Options: `enable`, `hold_time`, `ghost`, `ghost_opacity`, `ghost_scale` and `ghost_duration`.
