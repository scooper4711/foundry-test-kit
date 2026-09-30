# foundry-test-kit

Playwright integration testing for [Foundry VTT](https://foundryvtt.com) modules.
It runs a real Foundry server against your built module and gives your specs
what every module suite ends up writing by hand:

- **`foundry-test`** — a CLI that downloads and unpacks Foundry builds, keeps a
  data directory per version, starts/stops a dev and a test server side by
  side, seeds fresh worlds, and runs your Playwright suite against each
  configured world (one project per game system).
- **World seeding** — license key, EULA, game system installs, world creation,
  module activation, module settings, and a passwordless `TestPlayer`.
- **Fixtures** — a `test` whose `gmPage` is already inside the world as the
  Gamemaster (logged in once per worker), with Foundry's scene canvas turned
  off, and V8 coverage of your module recorded for every test.
- **Helpers** — joining as GM or player, clearing first-run popups, importing
  pregenerated characters, parties, settings, flags, and cleanup.
- **`foundry-test-coverage`** — maps the recorded coverage back onto your
  module's source files through its sourcemap.

## Why the scene canvas is off

Headless Chromium renders Foundry's WebGL scene in software, which keeps the
page's main thread so busy that every click and fill takes seconds. With
`core.noCanvas` set, suites run in roughly half the time. Most module UI never
touches the canvas; for a spec that drives system UI which does (PF2e's actor
sheets and actor directory read `canvas.tokens`), opt back in:

```ts
test.use({ sceneCanvas: true });
```

## Install

```bash
npm install --save-dev @scooper4711/foundry-test-kit @playwright/test
npx playwright install chromium
```

Requires Node 24+ (Foundry 14 needs it too) and bash.

## Configure

Add `foundry-test.config.json` at your project root:

```json
{
  "moduleId": "my-module",
  "foundryVersion": "14.367",
  "testWorlds": [
    { "id": "integration-test", "system": "pf2e", "title": "Integration Test" },
    { "id": "sfs-test", "system": "sf2e", "title": "SFS Test" }
  ],
  "devWorld": { "id": "my-dev-world", "system": "pf2e", "title": "My Dev World" },
  "systems": ["pf2e", "sf2e"],
  "seed": {
    "settings": [
      { "key": "apiToken", "fromEnv": "MY_API_TOKEN" },
      { "key": "debugLogging", "value": true }
    ]
  },
  "coverage": { "bundle": "dist/main.js" }
}
```

| Field | Meaning | Default |
|---|---|---|
| `moduleId` | Your module's id (its folder under `Data/modules`) | required |
| `foundryVersion` | Foundry build to run | `14.367` |
| `testWorlds` | Worlds the suite runs against; one Playwright project per `system` | one `integration-test` pf2e world |
| `devWorld` | World `foundry-test dev start` boots into | `dev-test` |
| `systems` | Game systems installed when seeding a data directory | every system named by a world |
| `seed.settings` | Module settings written into freshly seeded worlds (`value`, or `fromEnv` — skipped when unset) | none |
| `coverage.bundle` | Your built bundle, relative to the project root (must have a sourcemap) | `dist/main.js` |

Your project root is symlinked into each data directory as the module, so the
built bundle and `module.json` are served straight from your working tree.

Point Playwright at it with `playwright.config.mts`:

```ts
import { defineFoundryConfig } from "@scooper4711/foundry-test-kit";

export default defineFoundryConfig();
// or with per-system spec folders:
// defineFoundryConfig({
//   projects: [
//     { name: "pf2e", testIgnore: /starfinder\// },
//     { name: "sf2e", testMatch: /starfinder\/.*\.spec\.ts$/ },
//   ],
// });
```

Project names must be game system ids: `foundry-test test run` runs the project
matching the world it started.

Add scripts and ignore the working directories:

```json
{
  "scripts": {
    "foundry": "foundry-test",
    "integration": "foundry-test test run --all-worlds",
    "coverage:e2e": "foundry-test-coverage"
  }
}
```

```gitignore
playwright/
test-results/
coverage/
tmp/
```

## Secrets and `.env`

`foundry-test` and `defineFoundryConfig` read `.env` at the project root.

| Variable | Needed for |
|---|---|
| `FOUNDRY_LICENSE_KEY` | Seeding a new data directory |
| `FOUNDRY_USERNAME`, `FOUNDRY_PASSWORD` | Downloading a Foundry build from foundryvtt.com (not needed once it is cached) |
| `FOUNDRY_ADMIN_PASSWORD` | Optional; the servers' admin password (default `test-admin`) |
| `FOUNDRY_PORT`, `FOUNDRY_TEST_PORT` | Optional; dev and test ports (defaults 30000 and 30001) |

`.env` never overrides a variable that is already set in the environment.

### Keeping your foundryvtt.com password out of plain text

You do not have to put secrets in `.env` in plain text. The kit works
unchanged with [dotenvx](https://dotenvx.com) encrypted `.env` files, because
dotenvx decrypts into the environment of the command it runs and the kit never
overrides the environment:

```bash
npm install --save-dev @dotenvx/dotenvx
npx dotenvx set FOUNDRY_PASSWORD 'my-password'      # encrypts into .env
npx dotenvx set FOUNDRY_LICENSE_KEY 'XXXX-XXXX-...'
```

`.env` now holds `FOUNDRY_PASSWORD="encrypted:…"` (safe to commit), and the
private key lives in `.env.keys` (never commit it — add it to `.gitignore`).
Run the kit through dotenvx:

```bash
npx dotenvx run -- foundry-test test run --all-worlds
```

or bake it into your scripts:

```json
{ "integration": "dotenvx run -- foundry-test test run --all-worlds" }
```

Plain `.env` values still work, and you can mix plain and encrypted values.

## Run

```bash
npm run build                              # your module
npx foundry-test test run --all-worlds     # every test world, one after another
npx foundry-test test run --world sfs-test # one world
npx foundry-test-coverage                  # coverage/e2e/lcov.info for the last run
```

Servers:

```bash
npx foundry-test dev start      # port 30000, playwright/Data, your devWorld
npx foundry-test test start     # port 30001, playwright/Data-<version>, first testWorld
npx foundry-test test status
npx foundry-test test stop
npx foundry-test test run --keep     # leave the server up afterwards
npx foundry-test test run --clean    # wipe the world first and re-seed it
npx foundry-test test run --headed   # watch it (needs a display)
```

Against a server that is already running, plain Playwright works too:
`npx playwright test --project=pf2e`.

Foundry builds are cached in `playwright/cache/FoundryVTT-Node-<version>.zip`.
A missing build is downloaded from foundryvtt.com with `FOUNDRY_USERNAME` and
`FOUNDRY_PASSWORD` (your account must hold a license), or from a URL:
`npx foundry-test test start https://…/FoundryVTT-Node-14.367.zip`.

## Write tests

```ts
import { test, expect, importPregen, readActorFlag } from "@scooper4711/foundry-test-kit";

test("imports a pregen with a Society ID", async ({ gmPage }) => {
  const id = await importPregen(gmPage, {
    packId: "pf2e.iconics",
    entryName: "Amiri (Level 1)",
    name: "Test Amiri",
    society: { playerNumber: 123456, characterNumber: 2001, faction: "EA" },
  });
  expect(await readActorFlag(gmPage, id, "my-module", "someFlag")).toBeUndefined();
});
```

Extend the fixtures with your own page objects:

```ts
import { test as kitTest } from "@scooper4711/foundry-test-kit";

export const test = kitTest.extend<{ sheet: MySheet }>({
  sheet: async ({ gmPage }, use) => use(new MySheet(gmPage)),
});
```

For `beforeAll`/`afterAll` setup, where `gmPage` is not available:

```ts
test.beforeAll(async ({ browser, gamemasterSession }) => {
  await withGamemasterPage(browser, gamemasterSession, async (page) => {
    /* create actors, reset settings, … */
  });
});
```

Joining as a player needs its own context:

```ts
const context = await browser.newContext(suiteContextOptions());
await disableSceneCanvas(context);
const page = await context.newPage();
await joinAsPlayer(page, "TestPlayer");
```

Other helpers: `joinAsGamemaster`, `enterGameAsGamemaster`, `waitForGameReady`,
`ensureModuleActive`, `dismissOverlays`, `dismissTours`, `ensureAdminAccess`,
`createParty`, `deleteActorsByPrefix`, `deleteChatMessages`, `setSetting`,
`updateActor`, `readActorFlag`, `assignCharacterToUser`, `renderActorSheet`,
`closeAllSheets`, `gameSystemId`, `startCoverage`/`stopCoverage`.

## GitHub Actions

Add repository secrets `FOUNDRY_LICENSE_KEY`, `FOUNDRY_USERNAME` and
`FOUNDRY_PASSWORD` (Settings → Secrets and variables → Actions). The workflow
caches the Foundry build and the seeded data directory, so only the first run
downloads Foundry and installs game systems:

```yaml
name: Integration

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  integration:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "24.x"
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build

      - name: Cache Foundry builds and seeded worlds
        uses: actions/cache@v6
        with:
          path: |
            playwright/cache
            playwright/versions
            playwright/Data-*
          key: foundry-${{ hashFiles('foundry-test.config.json') }}

      - name: Integration tests
        run: npx foundry-test test run --all-worlds
        env:
          FOUNDRY_LICENSE_KEY: ${{ secrets.FOUNDRY_LICENSE_KEY }}
          FOUNDRY_USERNAME: ${{ secrets.FOUNDRY_USERNAME }}
          FOUNDRY_PASSWORD: ${{ secrets.FOUNDRY_PASSWORD }}

      - name: Coverage report
        if: always()
        run: npx foundry-test-coverage

      - uses: actions/upload-artifact@v7
        if: failure()
        with:
          name: playwright-results
          path: test-results/
```

Secrets from pull requests opened from forks are not available to workflows,
so forked PRs cannot run this job; gate it with
`if: github.event.pull_request.head.repo.full_name == github.repository` if
your repository takes outside contributions.

To use an encrypted `.env` in CI instead of individual secrets, store only the
dotenvx private key as a secret and run through dotenvx:

```yaml
      - name: Integration tests
        run: npx dotenvx run -- foundry-test test run --all-worlds
        env:
          DOTENV_PRIVATE_KEY: ${{ secrets.DOTENV_PRIVATE_KEY }}
```

## License

MIT
