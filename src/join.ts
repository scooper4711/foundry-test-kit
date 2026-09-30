/**
 * Joining a Foundry world from its /join page as a configured user, and
 * waiting for the game to be ready.
 */
import type { Locator, Page } from "@playwright/test";
import { loadTestKitConfig } from "./config.js";
import {
  joinButton,
  joinPasswordField,
  joinUserDropdown,
  joinUserOption,
  joinUserSuggestion,
  joinUserTextbox,
} from "./foundry-ui.js";
import { dismissOverlays } from "./overlays.js";
import { DEFAULT_GAMEMASTER_NAME, findSeedUser, seedUserPassword, type GamemasterAccount } from "./users.js";

const GAME_READY_TIMEOUT_MS = 90_000;

/** Resolves once `game.ready` is true on the page. */
export async function waitForGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (globalThis as unknown as { game?: { ready?: boolean } }).game?.ready === true, {
    timeout: GAME_READY_TIMEOUT_MS,
  });
}

/**
 * Joins the world as its Gamemaster, from the /join page: the configured
 * `seed.gamemaster` account unless another is given.
 */
export async function joinAsGamemaster(
  page: Page,
  account: GamemasterAccount = loadTestKitConfig().seed.gamemaster
): Promise<void> {
  await joinWorld(page, account);
}

/**
 * Opens /join and joins as a configured user (any role), using the access
 * key from `seed.users`.
 */
export async function joinAsUser(page: Page, userName: string): Promise<void> {
  await page.goto("/join");
  await joinWorld(page, { name: userName, password: seedUserPassword(loadTestKitConfig().seed, userName) });
}

/** Opens /join and joins as a player: the named one, or the first configured player. */
export async function joinAsPlayer(page: Page, userName?: string): Promise<void> {
  await joinAsUser(page, userName ?? findSeedUser(loadTestKitConfig().seed, "player").name);
}

/**
 * Joins as the Gamemaster while seeding: the configured account once it
 * exists, else the Gamemaster Foundry created with the world, which seeding
 * then renames. Returns the name joined as.
 */
export async function joinAsSeedingGamemaster(page: Page, account: GamemasterAccount): Promise<string> {
  if (await selectJoinUser(page, account.name)) {
    await submitJoin(page, account.password);
    return account.name;
  }
  await joinWorld(page, { name: DEFAULT_GAMEMASTER_NAME, password: "" });
  return DEFAULT_GAMEMASTER_NAME;
}

async function joinWorld(page: Page, account: GamemasterAccount): Promise<void> {
  if (!(await selectJoinUser(page, account.name))) {
    throw new Error(`joinWorld: user "${account.name}" is not on the join form (not seeded, or already logged in)`);
  }
  await submitJoin(page, account.password);
}

/** Fills the access key, clicks Join, and waits until the game is ready. */
async function submitJoin(page: Page, password: string): Promise<void> {
  if (password) await joinPasswordField(page).fill(password);
  const join = joinButton(page);
  await join.waitFor({ state: "visible", timeout: 15_000 });
  await Promise.all([page.waitForURL(/\/game/, { timeout: 90_000, waitUntil: "commit" }), join.click()]);
  await waitForReadyPastPasswordPrompt(page);
  await dismissOverlays(page);
}

/**
 * Picks the user on the join form: a <select> on Foundry 12 and 13, an
 * autocomplete textbox on 14. Waits for either, since the form renders
 * after page load. Returns false when the user is not offered.
 */
async function selectJoinUser(page: Page, userName: string): Promise<boolean> {
  const userDropdown = joinUserDropdown(page);
  const userTextbox = joinUserTextbox(page);
  await userDropdown
    .or(userTextbox)
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {});
  if (await userDropdown.isVisible().catch(() => false)) {
    if ((await joinUserOption(page, userName).count()) === 0) return false;
    await userDropdown.selectOption({ label: userName });
    return true;
  }
  if (!(await userTextbox.isVisible().catch(() => false))) return false;
  return chooseAutocompleteUser(page, userTextbox, userName);
}

/** Chooses the user from the join autocomplete (14); false when no suggestion matches. */
async function chooseAutocompleteUser(page: Page, userTextbox: Locator, userName: string): Promise<boolean> {
  await userTextbox.click().catch(() => {});
  await userTextbox.fill(userName);
  // click() auto-waits for the suggestion; isVisible() would not.
  return joinUserSuggestion(page, userName)
    .click({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
}

/**
 * A passwordless Gamemaster is prompted to set one on first join, which
 * blocks game load — save through it empty, then wait for ready. Polls
 * because the prompt can appear at any point during load.
 */
async function waitForReadyPastPasswordPrompt(page: Page): Promise<void> {
  const deadline = Date.now() + GAME_READY_TIMEOUT_MS;
  for (;;) {
    const saveContinue = page.getByRole("button", { name: "Save and Continue" });
    if (await saveContinue.isVisible({ timeout: 2000 }).catch(() => false)) {
      await saveContinue.click().catch(() => {});
      await saveContinue.waitFor({ state: "hidden", timeout: 2000 }).catch(() => {});
    }
    const ready = await page
      .waitForFunction(() => (globalThis as unknown as { game?: { ready?: boolean } }).game?.ready === true, {
        timeout: 3000,
      })
      .then(() => true)
      .catch(() => false);
    if (ready) return;
    if (Date.now() > deadline) throw new Error("joinWorld: game never became ready after joining");
  }
}
