# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-01

### Added

- Add foundry-test init
- Add typed document helpers

### Changed

- Compare with @thefehr/foundry-playwright; document init
- Exercise the document helpers on Foundry 12, 13 and 14
- Add npm keywords for discoverability

[0.3.0]: https://github.com/scooper4711/foundry-test-kit/releases/tag/v0.3.0

## [0.2.1] - 2026-09-30

### Fixed

- Retry rate-limited foundryvtt.com requests

### Changed

- Drop the release script symlink
- Explain why release-only CI needs a manual run on main
- Run E2E only on releases and by hand
- Suggest a pre-tag hook for local release checks
- Discourage hosted CI and explain how to cache Foundry
- Keep the Foundry license out of CI caches
- Cache Foundry builds by version and cancel superseded E2E runs

[0.2.1]: https://github.com/scooper4711/foundry-test-kit/releases/tag/v0.2.1

## [0.2.0] - 2026-09-30

### Added

- Re-seed when the seed config changes
- Seed and join as the configured users
- Configure seeded users and the Gamemaster account

### Changed

- Bump dotenv
- Exercise seeded users on Foundry 12, 13 and 14
- Document seeded test users

[0.2.0]: https://github.com/scooper4711/foundry-test-kit/releases/tag/v0.2.0

## [0.1.1] - 2026-09-30

### Fixed

- Match only visible package entries

### Changed

- Configure Dependabot like the other repos

[0.1.1]: https://github.com/scooper4711/foundry-test-kit/releases/tag/v0.1.1

## [0.1.0] - 2026-09-30

### Added

- Initial release

[0.1.0]: https://github.com/scooper4711/foundry-test-kit/releases/tag/v0.1.0
