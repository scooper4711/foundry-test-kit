/**
 * Builds a Playwright config for a Foundry module's integration suite.
 */
import { resolve } from "node:path";
import { defineConfig, type PlaywrightTestConfig, type Project } from "@playwright/test";
import { config as loadDotEnv } from "dotenv";
import { loadTestKitConfig } from "./config.js";
import { FOUNDRY_VIEWPORT, testBaseUrl } from "./context.js";

export interface FoundryConfigOptions {
  /** Spec directory, relative to the project root (default "tests/integration"). */
  testDir?: string;
  /**
   * Projects to run. Defaults to one per game system in `testWorlds`, named
   * after the system; `foundry-test test run` selects the project matching
   * the world it starts, so project names must be system ids.
   */
  projects?: Project[];
  /** Anything else to merge into the Playwright config. */
  overrides?: PlaywrightTestConfig;
}

export function defineFoundryConfig(options: FoundryConfigOptions = {}): PlaywrightTestConfig {
  const kit = loadTestKitConfig();
  loadDotEnv({ path: resolve(kit.projectRoot, ".env"), quiet: true });
  const systems = [...new Set(kit.testWorlds.map((world) => world.system))];
  return defineConfig({
    testDir: resolve(kit.projectRoot, options.testDir ?? "tests/integration"),
    // First loads of a system and its compendiums are slow on a busy machine.
    timeout: 180_000,
    retries: 0,
    // One Foundry server serves one session at a time.
    workers: 1,
    use: {
      baseURL: testBaseUrl(),
      // Headed when PLAYWRIGHT_HEADED=true (foundry-test --headed).
      headless: process.env.PLAYWRIGHT_HEADED !== "true",
      viewport: FOUNDRY_VIEWPORT,
    },
    projects: options.projects ?? systems.map((system) => ({ name: system })),
    ...options.overrides,
  });
}
