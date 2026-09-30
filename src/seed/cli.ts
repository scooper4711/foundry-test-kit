#!/usr/bin/env node
/**
 * Seeds a fresh Foundry data directory: license, game systems, test world,
 * module and its settings, and a player user. Run by `foundry-test` when the
 * selected world does not exist yet.
 *
 * Environment: FOUNDRY_PORT, FOUNDRY_LICENSE_KEY, FOUNDRY_ADMIN_PASSWORD,
 * FOUNDRY_SYSTEM_IDS (comma separated), FOUNDRY_WORLD_SYSTEM,
 * SEED_WORLD_TITLE, PLAYWRIGHT_HEADED.
 */
import { chromium, type Page } from "@playwright/test";
import { loadTestKitConfig } from "../config.js";
import { FOUNDRY_VIEWPORT } from "../context.js";
import { isMainModule } from "../cli/is-main.js";
import { finishWorld } from "./finish.js";
import { reachSetup } from "./license.js";
import { log, systemDisplayName, type SeedOptions } from "./options.js";
import { installSystems } from "./systems.js";
import { createWorld, launchWorld } from "./world.js";

/** The phases are idempotent, so a failed attempt retries from the top. */
const MAX_ATTEMPTS = 2;

export async function seedFoundry(page: Page, options: SeedOptions): Promise<void> {
  await reachSetup(page, options);
  if (page.url().includes("/setup")) {
    await installSystems(page, options.systemIds);
    await createWorld(page, options.worldTitle, options.worldSystem);
    await launchWorld(page, options.worldTitle);
  }
  const moduleStatus = await finishWorld(page, options);
  log("\n=== Seeding complete ===");
  log(`  Systems: ${options.systemIds.join(", ")}`);
  log(`  World: ${options.worldTitle} (${systemDisplayName(options.worldSystem)})`);
  log(`  Module: ${options.moduleId} (${moduleStatus})`);
  log(`  Users: Gamemaster (no password), ${options.playerName} (no password)`);
}

export function seedOptionsFromEnv(env: NodeJS.ProcessEnv): SeedOptions {
  const config = loadTestKitConfig();
  const licenseKey = env.FOUNDRY_LICENSE_KEY ?? "";
  if (!licenseKey) {
    throw new Error("seedOptionsFromEnv: FOUNDRY_LICENSE_KEY is required to seed a fresh data directory");
  }
  const systemIds = (env.FOUNDRY_SYSTEM_IDS ?? config.systems.join(","))
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const worldSystem = env.FOUNDRY_WORLD_SYSTEM ?? systemIds[0] ?? "pf2e";
  return {
    baseUrl: `http://localhost:${env.FOUNDRY_PORT ?? "30000"}`,
    licenseKey,
    adminPassword: env.FOUNDRY_ADMIN_PASSWORD ?? "test-admin",
    systemIds: systemIds.includes(worldSystem) ? systemIds : [...systemIds, worldSystem],
    worldSystem,
    worldTitle: env.SEED_WORLD_TITLE ?? "Integration Test",
    moduleId: config.moduleId,
    settings: config.seed.settings,
    playerName: "TestPlayer",
  };
}

async function main(): Promise<void> {
  const options = seedOptionsFromEnv(process.env);
  const browser = await chromium.launch({ headless: process.env.PLAYWRIGHT_HEADED !== "true" });
  try {
    for (let attempt = 1; ; attempt++) {
      const page = await browser.newPage({ viewport: FOUNDRY_VIEWPORT });
      try {
        await seedFoundry(page, options);
        return;
      } catch (failure) {
        if (attempt >= MAX_ATTEMPTS) throw failure;
        log(`[seed] attempt ${attempt} failed (${String(failure)}); retrying...`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((failure: unknown) => {
    console.error(failure instanceof Error ? failure.message : failure);
    process.exit(1);
  });
}
