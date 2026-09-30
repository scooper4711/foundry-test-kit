/**
 * The kit's Playwright `test`: every page records V8 coverage of the module
 * bundle, runs without the scene canvas (unless a spec opts in with
 * `test.use({ sceneCanvas: true })`), and `gmPage` starts inside the world as
 * the Gamemaster. The GM logs in once per worker and tests reuse the session.
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { loadTestKitConfig } from "./config.js";
import { disableSceneCanvas, suiteContextOptions } from "./context.js";
import { coverageChunkName, startCoverage, stopCoverage } from "./coverage.js";
import { enterGameAsGamemaster, joinAsGamemaster } from "./session.js";
import { gameSystemId } from "./world.js";

export { expect };

export interface FoundryTestOptions {
  /** Keep Foundry's scene canvas (slow; only for system UI that needs it). */
  sceneCanvas: boolean;
}

export interface FoundryTestFixtures {
  /** A page inside the world as the Gamemaster. */
  gmPage: Page;
  /** Internal: records coverage for every test's page. */
  recordCoverage: void;
}

export interface FoundryWorkerFixtures {
  /** Path of a storage state file holding a Gamemaster session. */
  gamemasterSession: string;
}

export const test = base.extend<FoundryTestOptions & FoundryTestFixtures, FoundryWorkerFixtures>({
  sceneCanvas: [false, { option: true }],

  gamemasterSession: [
    async ({ browser }, use, workerInfo) => {
      const config = loadTestKitConfig();
      const sessionDirectory = resolve(config.workDir, "sessions");
      mkdirSync(sessionDirectory, { recursive: true });
      const statePath = resolve(sessionDirectory, `gamemaster-${workerInfo.workerIndex}.json`);
      const context = await browser.newContext(suiteContextOptions());
      await disableSceneCanvas(context);
      try {
        const page = await context.newPage();
        await page.goto("/join");
        await joinAsGamemaster(page);
        expectWorldSystem(await gameSystemId(page), workerInfo.project.name, config.systems);
        await context.storageState({ path: statePath });
      } finally {
        await context.close();
      }
      await use(statePath);
    },
    { scope: "worker" },
  ],

  storageState: async ({ gamemasterSession }, use) => {
    await use(gamemasterSession);
  },

  context: async ({ context, sceneCanvas }, use) => {
    if (!sceneCanvas) await disableSceneCanvas(context);
    await use(context);
  },

  recordCoverage: [
    async ({ page }, use, testInfo) => {
      await startCoverage(page);
      await use();
      await stopCoverage(page, coverageChunkName(testInfo.project.name, testInfo.file, testInfo.title));
    },
    { auto: true },
  ],

  gmPage: async ({ page }, use) => {
    await enterGameAsGamemaster(page);
    await use(page);
  },
});

/** Fails fast when a system-named project runs against another system's world. */
function expectWorldSystem(worldSystem: string, projectName: string, systems: string[]): void {
  if (!systems.includes(projectName) || worldSystem === projectName) return;
  throw new Error(
    `The ${projectName} tests need a ${projectName} world, but the server is running a ${worldSystem} world. ` +
      "Start the matching world (foundry-test test start --world <id>) or pick --project."
  );
}
