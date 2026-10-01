# foundry-test-kit

Playwright integration testing for [Foundry VTT](https://foundryvtt.com) modules.
It runs a real Foundry server against your built module and gives your specs
what every module suite ends up writing by hand:

- **`foundry-test`** — a CLI that downloads and unpacks Foundry builds, keeps a
  data directory per version, starts/stops a dev and a test server side by
  side, seeds fresh worlds, and runs your Playwright suite against each
  configured world (one project per game system).
- **World seeding** — license key, EULA, game system installs, world creation,
  module activation, module settings, and test users at whatever
  permission levels your specs need.
- **Fixtures** — a `test` whose `gmPage` is already inside the world as the
  Gamemaster (logged in once per worker), with Foundry's scene canvas turned
  off, and V8 coverage of your module recorded for every test.
- **Helpers** — joining as GM or player, clearing first-run popups, typed
  document access (find an actor by id, name, or flag; wait for actors and
  settings; create, update, delete any document), pregenerated characters,
  parties, settings, flags, and cleanup.
- **`foundry-test init`** — scaffolds the config, a Playwright config, a smoke
  spec, and npm scripts from your `module.json`.
- **`foundry-test-coverage`** — maps the recorded coverage back onto your
  module's source files through its sourcemap.

## foundry-test-kit or @thefehr/foundry-playwright?

[@thefehr/foundry-playwright](https://github.com/TheFehr/foundry-playwright) is
another Playwright library for Foundry modules, older than this kit and with a
broader toolbox for writing test steps. They overlap but are built around
different ideas: it is a library your tests call to set up and drive Foundry,
often in Docker; this kit is a harness that owns the server and pre-seeded
worlds, so specs start inside a ready world.

Choose **@thefehr/foundry-playwright** when you want:

- game-system and sheet UI adapters (dnd5e, PF2e, Tidy5e), canvas and token
  interaction, and drag-and-drop simulation;
- hooks, sockets, rolls, currency, ownership, and other state helpers;
- per-test isolation by restoring a world backup;
- Foundry in Docker containers.

Choose **foundry-test-kit** when you want:

- no Docker: Foundry runs as a plain Node process, with separate dev and test
  servers;
- coverage of your module's own source, mapped through its sourcemap, so you
  can gate on integration coverage;
- worlds seeded once from a config file (license, systems, module settings,
  users by role) and reused, with the Gamemaster logged in once per worker;
- several game systems in one suite, one Playwright project per world;
- Foundry 12 through 14, with `latest` and `latest-<major>` resolved for you;
- careful downloading for CI (see [Continuous integration](#continuous-integration)).

They can work together: the kit's fixtures give you a Playwright `Page`, which
is all @thefehr/foundry-playwright's `FoundryState`, `FoundryUI`, and
`FoundryCanvas` classes need.

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

Then, from your module's root (next to `module.json`):

```bash
npx foundry-test init
```

It writes `foundry-test.config.json` (a test world per game system your
`module.json` declares, or Simple Worldbuilding if it declares none; your
first `esmodules` entry as the coverage bundle), `playwright.config.mts`, a
smoke spec in `tests/integration/`, an `integration` script plus
`integration:v<major>` for each older Foundry major in your compatibility
range, and `.gitignore` entries. It never overwrites a file or script that
already exists. The rest of this section describes what it writes.

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

| Field             | Meaning                                                                                           | Default                           |
| ----------------- | ------------------------------------------------------------------------------------------------- | --------------------------------- |
| `moduleId`        | Your module's id (its folder under `Data/modules`)                                                | required                          |
| `foundryVersion`  | Foundry build to run: a version, `latest` (newest stable), or `latest-<major>` (e.g. `latest-13`) | `14.367`                          |
| `testWorlds`      | Worlds the suite runs against; one Playwright project per `system`                                | one `integration-test` pf2e world |
| `devWorld`        | World `foundry-test dev start` boots into                                                         | `dev-test`                        |
| `systems`         | Game systems installed when seeding a data directory                                              | every system named by a world     |
| `seed.settings`   | Module settings written into freshly seeded worlds (`value`, or `fromEnv` — skipped when unset)   | none                              |
| `seed.gamemaster` | The world's Gamemaster: `name`, optional `password` (see [Test users](#test-users))               | `Gamemaster`, no password         |
| `seed.users`      | Extra users: `name`, `role`, optional `password` (see [Test users](#test-users))                  | one `TestPlayer` player           |
| `coverage.bundle` | Your built bundle, relative to the project root (must have a sourcemap)                           | `dist/main.js`                    |
| `workDir`         | Where the kit keeps Foundry builds, servers, data directories, logs, and sessions                 | `.foundry-test`                   |

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
.foundry-test/
test-results/
coverage/
tmp/
```

## Secrets and `.env`

`foundry-test` and `defineFoundryConfig` read `.env` at the project root.

| Variable                               | Needed for                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `FOUNDRY_LICENSE_KEY`                  | Seeding a new data directory                                                   |
| `FOUNDRY_USERNAME`, `FOUNDRY_PASSWORD` | Downloading a Foundry build from foundryvtt.com (not needed once it is cached) |
| `FOUNDRY_ADMIN_PASSWORD`               | Optional; the servers' admin password (default `test-admin`)                   |
| `FOUNDRY_PORT`, `FOUNDRY_TEST_PORT`    | Optional; dev and test ports (defaults 30000 and 30001)                        |

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
npx foundry-test dev start      # port 30000, .foundry-test/Data-dev-<version>, your devWorld
npx foundry-test test start     # port 30001, .foundry-test/Data-test-<version>, first testWorld
npx foundry-test test status
npx foundry-test test stop
npx foundry-test test run --keep     # leave the server up afterwards
npx foundry-test test run --clean    # wipe the world first and re-seed it
npx foundry-test test run --headed   # watch it (needs a display)
```

Against a server that is already running, plain Playwright works too:
`npx playwright test --project=pf2e`.

`--version latest` runs the newest stable release listed on foundryvtt.com,
and `--version latest-13` the newest stable 13.x — handy for keeping a module
compatible with the previous major. Directories still use the concrete number
(e.g. `Data-test-14.368`, `Data-test-13.351`), so versions never mix. Offline,
a symbolic version falls back to the newest matching version already unpacked.
`npx foundry-test resolve latest-13` prints what a symbolic version means today.

Everything lives in `.foundry-test/` (the config's `workDir`): Foundry builds in
`cache/FoundryVTT-Node-<version>.zip`, unpacked servers in `versions/`, one
data directory per server and version (`Data-dev-14.367`, `Data-test-14.367`),
server logs and results in `logs/`, and saved Gamemaster sessions in
`sessions/`. Nothing in it belongs in version control. A world is seeded once:
seeding leaves a `.seeded-<world>` marker in the data directory when it
finishes, so a run interrupted mid-seed simply seeds again next time.
A missing build is downloaded from foundryvtt.com with `FOUNDRY_USERNAME` and
`FOUNDRY_PASSWORD` (your account must hold a license), or from a URL:
`npx foundry-test test start https://…/FoundryVTT-Node-14.367.zip`.

## Test users

Every seeded world gets a Gamemaster and the users listed under `seed.users`:

```json
{
  "seed": {
    "gamemaster": { "name": "Game Master" },
    "users": [
      { "name": "Pat", "role": "player" },
      { "name": "Tess", "role": "trusted" },
      { "name": "Ada", "role": "assistant" }
    ]
  }
}
```

- `role` is one of `player` (the default), `trusted`, `assistant` or `gamemaster`,
  Foundry's permission levels.
- Passwords are optional, and nobody has one unless you set `password`. Test
  users rarely need one; the option is there for code that behaves differently
  with an access key.
- The Gamemaster is the one Foundry creates with every world: the kit renames it
  to `seed.gamemaster.name` and joins as it.
- Without `seed.users`, the kit seeds one player, `TestPlayer`. An empty list
  seeds none.
- Changing any of this re-seeds the world on the next run. Seeding records a
  fingerprint of the seed config, and existing users are updated in place.

In specs, name users through the config rather than repeating them:

```ts
import { joinAsPlayer, joinAsUser, testUser } from "@scooper4711/foundry-test-kit";

await joinAsPlayer(page); // the first configured player
await joinAsUser(page, testUser("trusted").name); // any role; its password comes from the config
```

## Foundry versions

The kit supports Foundry 12, 13 and 14, and rejects anything older. The same
config, CLI, seeding and fixtures work on all three; the setup, join and
world-creation screens differ between majors, and the kit's locators for them
live in one file, `src/foundry-ui.ts`, each noting what differs.

Things to know about Foundry 12:

- It ignores the `--port` and `--world` command-line options, so the kit writes
  them into the data directory's `Config/options.json` before starting it.
- Under Node 24 it raises a permanent notification that comes back when
  cleared. It runs fine; the kit stops clearing it after a couple of tries.
- Document classes such as `Actor`, `User` and `ChatMessage` are not properties
  of `globalThis` there. In `page.evaluate`, reach them through `CONFIG` —
  `CONFIG.Actor.documentClass.create(...)` — which works on every version.

The kit's own E2E workflow seeds a Simple Worldbuilding world with a fixture
module and runs its specs on `latest-12`, `latest-13` and `latest`, when a
release is published and when run by hand (see `.github/workflows/e2e.yml` and
`e2e/fixture-module/`). Changes to the browser-driven code are checked locally
with `npm run e2e`, or by running the workflow by hand on the branch.

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
await joinAsPlayer(page); // or joinAsUser(page, testUser("trusted").name)
```

Read and change documents without writing `page.evaluate` boilerplate. Name an
actor by `id`, `name`, or a module flag; functions passed to `evaluate` and
`waitFor` run in the browser, typed, like `page.evaluate` callbacks (they can
use their arguments and Foundry's globals, not the spec's variables):

```ts
import { actorOn, createDocuments, waitForSetting } from "@scooper4711/foundry-test-kit";

const hero = actorOn(gmPage, { flag: { scope: "my-module", key: "characterId", value: "abc" } });
const hp = await hero.evaluate((actor) => actor.system.attributes.hp.value);
await hero.evaluate((actor, value) => actor.update({ "system.attributes.hp.value": value }), 3);
await hero.waitFor((actor) => actor.getFlag("my-module", "syncing") !== true);

await waitForSetting(gmPage, { scope: "my-module", key: "writeLevel", value: "full" });
const [rope] = await createDocuments(gmPage, "Item", [{ name: "Rope", type: "equipment" }]);
```

`updateDocuments` and `deleteDocuments` work the same way for any document
type.

Other helpers: `joinAsGamemaster`, `testUser`, `enterGameAsGamemaster`, `waitForGameReady`,
`ensureModuleActive`, `dismissOverlays`, `dismissTours`, `ensureAdminAccess`,
`createParty`, `deleteActorsByPrefix`, `deleteChatMessages`, `setSetting`,
`updateActor`, `readActorFlag`, `assignCharacterToUser`, `renderActorSheet`,
`closeAllSheets`, `gameSystemId`, `startCoverage`/`stopCoverage`.

## Continuous integration

**Please don't run this in hosted CI (GitHub Actions and the like) unless you
really need to.** A CI job without a working cache downloads a full Foundry
build from foundryvtt.com every time it runs, and serving those downloads costs
Foundry Gaming money. The Foundry community moderators have asked module
developers not to set this up casually: a misconfigured cache on a busy
repository means a download on every push. Running the suite on your own
machine before you release covers most needs (see [Before a release](#before-a-release)).

### How often the kit downloads Foundry

- At most one download per `foundry-test` run: only when
  `.foundry-test/cache/FoundryVTT-Node-<version>.zip` is missing. The file
  transfer is never retried; if it fails, the partial file is deleted and the
  command stops.
- The login and download-link requests before it are retried up to four times
  each, and only when foundryvtt.com answers 429 (rate limited) or with a server
  error, waiting 30, 60 and 120 seconds (or as long as the site asks).
- Seeding retries, `--all-worlds`, and later runs reuse the zip on disk.

So the count to watch is how many runs start without the zip: on your machine
that's once per Foundry version; in CI it's every job whose cache misses.

### Before a release

Run the suite locally before you tag a release, once per Foundry major you
support. Your machine downloads each Foundry version once and keeps it.

```bash
npx foundry-test test run --all-worlds --version latest-13
npx foundry-test test run --all-worlds --version latest
```

To make that automatic, run it from a pre-tag hook. Git has no hook that fires
on `git tag`, but a release script can run one right before it tags, so a
failing suite stops the release before any tag exists:

```bash
# in your release script, just before `git tag "$NEXT_TAG"`
if [[ -x .husky/pre-tag ]]; then
  .husky/pre-tag "$NEXT_TAG" || { echo "pre-tag hook failed; $NEXT_TAG not created."; exit 1; }
fi
```

```sh
#!/usr/bin/env sh
# .husky/pre-tag: the integration suite on each Foundry major the module supports
set -e
npm run build
npx foundry-test test run --all-worlds --version latest-13
npx foundry-test test run --all-worlds --version latest
```

### If you do run it in CI

Get the caching right before you let it run regularly:

- **Trigger it rarely:** on published releases and by hand (`workflow_dispatch`),
  not on every push or pull request. Keep the version matrix to the majors you
  support.
- **Cache the Foundry build by version alone**, in its own cache entry
  (`foundry-build-<version>` below), separate from the seeded worlds. A key that
  includes anything else (a config hash, a date, the commit) downloads Foundry
  again every time that part changes.
- **Check the second run.** Its log must show
  `Cache restored from key: foundry-build-…` and must not show
  `Downloading Foundry VTT`. If it downloads again, fix the cache before
  running it any more.
- **Fill the cache from the default branch.** A workflow that only runs on
  releases never reuses its own caches (see
  [Why release runs need a manual run on main](#why-release-runs-need-a-manual-run-on-main)).
  Run it once by hand on the default branch after each new Foundry release.
- **Don't let runs pile up:** the `concurrency` group cancels superseded runs.
- **Keep your license out of caches:** the last step deletes `license.json` (see
  below).

#### Why release runs need a manual run on main

GitHub scopes every Actions cache entry to the branch or tag whose run saved
it. A run can restore caches saved under its own ref, or under the default
branch (and, for a pull request, its base branch), but not under any other
branch or tag. A release runs under its tag: the `v1.2.0` run saves its caches
under `refs/tags/v1.2.0`, and the `v1.3.0` run can't see them. It falls back to
the default branch, and if the workflow never runs there, there is nothing to
restore. Every release then downloads Foundry again, once per version in the
matrix.

The fix is the `workflow_dispatch` trigger: after a new Foundry release (when
`latest` or `latest-<major>` resolves to a new version), run the workflow once
by hand on the default branch (Actions → the workflow → Run workflow). That
run downloads each build once and saves the caches under the default branch,
where every later release run, and any manual run on another branch, restores
them. A cache nobody restores for 7 days is deleted, and a repository's caches
are capped at 10 GB in total (oldest evicted first), so run it again if a
release log shows `Downloading Foundry VTT`.

Add repository secrets `FOUNDRY_LICENSE_KEY`, `FOUNDRY_USERNAME` and
`FOUNDRY_PASSWORD` (Settings → Secrets and variables → Actions). This workflow
follows the checklist:

```yaml
name: Integration

# Not on every push or pull request: each job needs a Foundry server.
on:
  release:
    types: [published]
  workflow_dispatch:

# A newer run for the same ref cancels the one it supersedes.
concurrency:
  group: integration-${{ github.ref }}
  cancel-in-progress: true

jobs:
  integration:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    strategy:
      fail-fast: false
      matrix:
        foundry: [latest, latest-13]
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "24.x"
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build

      - name: Resolve Foundry version
        id: foundry
        run: echo "version=$(npx foundry-test resolve ${{ matrix.foundry }})" >> "$GITHUB_OUTPUT"

      - name: Cache Foundry build
        uses: actions/cache@v6
        with:
          path: |
            .foundry-test/cache/FoundryVTT-Node-${{ steps.foundry.outputs.version }}.zip
            .foundry-test/versions/${{ steps.foundry.outputs.version }}
          key: foundry-build-${{ steps.foundry.outputs.version }}

      - name: Cache seeded worlds
        uses: actions/cache@v6
        with:
          path: .foundry-test/Data-test-${{ steps.foundry.outputs.version }}
          key: foundry-data-${{ steps.foundry.outputs.version }}-${{ hashFiles('foundry-test.config.json') }}

      - name: Integration tests
        run: npx foundry-test test run --all-worlds --version ${{ steps.foundry.outputs.version }}
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
          name: playwright-results-${{ steps.foundry.outputs.version }}
          path: test-results/

      # Caches are saved after the last step: keep the license out of them.
      - name: Remove license before caching
        if: always()
        run: rm -f .foundry-test/Data-test-*/Config/license.json
```

The Foundry build is cached by version alone and the seeded worlds by version
and config, so a new Foundry release is downloaded once, and a config change
re-seeds without downloading Foundry again.

If foundryvtt.com rate limits the downloads (HTTP 429), the kit waits and
retries as described above. A seeded data directory restored from the cache on
another runner is re-licensed automatically, since Foundry ties its license to
the machine.

Pull requests from forks can restore the default branch's caches and run their
own version of the workflow. The last step therefore deletes the signed
`license.json` before the caches are saved; the license key itself only reaches
jobs as a secret, which fork PRs never get. In a public repository, also require
approval for workflows from all outside contributors (Settings → Actions →
General → "Require approval for all external contributors"), so no one else's
workflow can read the cached Foundry build.

## Releasing

A release is a signed `vX.Y.Z` tag on `main`, with its `CHANGELOG.md` entry and
a draft GitHub release. The version follows the Conventional Commits since the
last tag. Publishing the draft runs `.github/workflows/release.yml`, which
stamps the version from the tag into `package.json` (it holds `#VERSION#` in
the repository) and publishes to npm through trusted publishing, with build
provenance.

## License

MIT
