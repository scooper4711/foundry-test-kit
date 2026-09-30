#!/usr/bin/env node
/**
 * Seeds a fresh Foundry data directory: license, game systems, test world,
 * module and its settings, and a player user. Run by `foundry-test` when the
 * selected world does not exist yet.
 *
 * Environment: FOUNDRY_PORT, FOUNDRY_LICENSE_KEY, FOUNDRY_ADMIN_PASSWORD,
 * FOUNDRY_SYSTEM_IDS (comma separated), FOUNDRY_WORLD_SYSTEM,
 * SEED_WORLD_TITLE, FOUNDRY_VERSION (names failure evidence), PLAYWRIGHT_HEADED.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
  log(`  Users: ${describeUsers(options)}`);
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
    gamemaster: config.seed.gamemaster,
    users: config.seed.users,
  };
}

function describeUsers({ gamemaster, users }: SeedOptions): string {
  const access = (password: string) => (password ? "password" : "no password");
  return [
    `${gamemaster.name} (gamemaster, ${access(gamemaster.password)})`,
    ...users.map((user) => `${user.name} (${user.role}, ${access(user.password)})`),
  ].join(", ");
}

/**
 * Saves a screenshot and the markup of any open dialogs (or the whole body,
 * on a page without one) to the work dir's logs/, so a seeding failure on
 * an unfamiliar Foundry version shows what was on screen. Named by version
 * so runs against several versions at once keep their own evidence.
 */
async function saveFailureEvidence(page: Page, attempt: number): Promise<void> {
  const directory = resolve(loadTestKitConfig().workDir, "logs");
  mkdirSync(directory, { recursive: true });
  const version = process.env.FOUNDRY_VERSION ?? "unknown";
  const base = resolve(directory, `seed-failure-${version}-${attempt}`);
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  const markup = await page
    .evaluate(() => {
      const dialogs = [...document.querySelectorAll("[role=dialog], dialog, .window-app")];
      return dialogs.length > 0 ? dialogs.map((el) => el.outerHTML).join("\n\n") : document.body.outerHTML;
    })
    .catch(() => "<unreadable>");
  writeFileSync(`${base}.html`, `<!-- ${page.url()} -->\n${markup}`);
  log(`[seed] saved ${base}.png and .html`);
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
        await saveFailureEvidence(page, attempt);
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
