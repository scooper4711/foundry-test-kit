/**
 * Seeding phases 5–8: join as the Gamemaster and bring its account in line
 * with the config, enable the module and write its configured settings,
 * and create or update the configured test users.
 */
import type { Page } from "@playwright/test";
import type { SeedSetting } from "../config.js";
import { joinAsSeedingGamemaster, waitForGameReady } from "../join.js";
import { dismissOverlays } from "../overlays.js";
import { ensureModuleActive } from "../session.js";
import { USER_ROLE_LEVELS, type GamemasterAccount, type SeedUser } from "../users.js";
import { setSetting } from "../world.js";
import { log, type SeedOptions } from "./options.js";
import { missingSettingVariables, resolveSettings } from "./settings.js";

export async function finishWorld(page: Page, options: SeedOptions): Promise<string> {
  if (page.url().includes("/join")) {
    log("-> Joining as Gamemaster...");
    await joinAsSeedingGamemaster(page, options.gamemaster);
  }
  await waitForGameReady(page);
  await dismissOverlays(page);
  await updateGamemaster(page, options.gamemaster);

  log("-> Enabling module...");
  const moduleStatus = await ensureModuleActive(page, options.moduleId);
  log(`-> Module status: ${moduleStatus}`);
  if (moduleStatus === "not_found") {
    throw new Error(`finishWorld: module ${options.moduleId} is not installed — is it symlinked into Data/modules?`);
  }
  await applySettings(page, options.moduleId, options.settings);
  for (const user of options.users) {
    log(`-> User ${user.name} (${user.role}): ${await ensureUser(page, user)}`);
  }
  return moduleStatus;
}

/**
 * Renames the joined Gamemaster (Foundry's own "Gamemaster" in a new world)
 * and sets its access key, so later joins use the configured account.
 */
async function updateGamemaster(page: Page, account: GamemasterAccount): Promise<void> {
  await page.evaluate(async ({ name, password }) => {
    const g = globalThis as unknown as {
      game: { user: { update(data: Record<string, unknown>): Promise<unknown> } };
    };
    await g.game.user.update({ name, password });
  }, account);
  log(`-> Gamemaster account: ${account.name}`);
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

/**
 * Creates the user, or sets the role and access key of an existing one
 * (Foundry does not reveal stored keys, so they are always rewritten).
 */
async function ensureUser(page: Page, user: SeedUser): Promise<string> {
  return page.evaluate(
    async ({ name, password, role }) => {
      type UserDocument = { name: string; update(data: Record<string, unknown>): Promise<unknown> };
      const g = globalThis as unknown as {
        game: { users: { find(predicate: (user: UserDocument) => boolean): UserDocument | undefined } };
        CONFIG: { User: { documentClass: { create(data: Record<string, unknown>): Promise<unknown> } } };
      };
      const existing = g.game.users.find((candidate) => candidate.name === name);
      if (existing) {
        await existing.update({ role, password });
        return "updated";
      }
      // Not the global User: Foundry 12 declares it in a classic script, so it
      // is not a property of globalThis.
      await g.CONFIG.User.documentClass.create({ name, role, password });
      return "created";
    },
    { name: user.name, password: user.password, role: USER_ROLE_LEVELS[user.role] }
  );
}
