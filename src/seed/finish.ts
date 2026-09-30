/**
 * Seeding phases 5–7: join as Gamemaster, enable the module and write its
 * configured settings, and create the passwordless test player.
 */
import type { Page } from "@playwright/test";
import type { SeedSetting } from "../config.js";
import { dismissOverlays } from "../overlays.js";
import { ensureModuleActive, joinAsGamemaster, waitForGameReady } from "../session.js";
import { setSetting } from "../world.js";
import { log, type SeedOptions } from "./options.js";
import { missingSettingVariables, resolveSettings } from "./settings.js";

export async function finishWorld(page: Page, options: SeedOptions): Promise<string> {
  if (page.url().includes("/join")) {
    log("-> Joining as Gamemaster...");
    await joinAsGamemaster(page);
  }
  await waitForGameReady(page);
  await dismissOverlays(page);

  log("-> Enabling module...");
  const moduleStatus = await ensureModuleActive(page, options.moduleId);
  log(`-> Module status: ${moduleStatus}`);
  if (moduleStatus === "not_found") {
    throw new Error(`finishWorld: module ${options.moduleId} is not installed — is it symlinked into Data/modules?`);
  }
  await applySettings(page, options.moduleId, options.settings);
  log(`-> Player user: ${await ensurePlayer(page, options.playerName)}`);
  return moduleStatus;
}

async function applySettings(page: Page, moduleId: string, settings: SeedSetting[]): Promise<void> {
  for (const variable of missingSettingVariables(settings, process.env)) {
    log(`-> ${variable} not set; skipping the setting that reads it.`);
  }
  for (const { key, value } of resolveSettings(settings, process.env)) {
    await setSetting(page, moduleId, key, value);
    log(`>>> Setting ${moduleId}.${key} stored.`);
  }
}

async function ensurePlayer(page: Page, playerName: string): Promise<string> {
  return page.evaluate(async (name) => {
    const g = globalThis as unknown as {
      game: { users: { find(predicate: (user: { name: string }) => boolean): unknown } };
      CONFIG: { User: { documentClass: { create(data: Record<string, unknown>): Promise<unknown> } } };
    };
    if (g.game.users.find((user) => user.name === name)) return "exists";
    // Not the global User: Foundry 12 declares it in a classic script, so it
    // is not a property of globalThis.
    await g.CONFIG.User.documentClass.create({ name, role: 1, password: "" });
    return "created";
  }, playerName);
}
