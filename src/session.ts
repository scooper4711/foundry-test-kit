/**
 * Joining a Foundry world as a given user and waiting for the game to be
 * ready, plus making sure the module under test is enabled.
 */
import type { Browser, Locator, Page } from "@playwright/test";
import { disableSceneCanvas, suiteContextOptions } from "./context.js";
import { joinButton, joinUserDropdown, joinUserSuggestion, joinUserTextbox } from "./foundry-ui.js";
import { dismissOverlays } from "./overlays.js";

const GAME_READY_TIMEOUT_MS = 90_000;

/** Resolves once `game.ready` is true on the page. */
export async function waitForGameReady(page: Page): Promise<void> {
  await page.waitForFunction(() => (globalThis as unknown as { game?: { ready?: boolean } }).game?.ready === true, {
    timeout: GAME_READY_TIMEOUT_MS,
  });
}

/**
 * Opens /game on a context that already carries a Gamemaster session
 * cookie, falling back to the join form when the session has expired (for
 * example after a server restart). An already-seeded world shows no
 * first-run popups, so there is nothing to wait for and dismiss.
 */
export async function enterGameAsGamemaster(page: Page): Promise<void> {
  await page.goto("/game");
  if (page.url().includes("/join")) {
    await joinAsGamemaster(page);
    return;
  }
  await waitForGameReady(page);
}

/**
 * Runs `action` on a fresh page that is inside the world as the Gamemaster
 * (no scene canvas), closing it afterwards. For beforeAll/afterAll setup,
 * where the `gmPage` fixture is not available.
 *
 * @param sessionPath - The `gamemasterSession` worker fixture
 */
export async function withGamemasterPage<T>(
  browser: Browser,
  sessionPath: string,
  action: (page: Page) => Promise<T>
): Promise<T> {
  const context = await browser.newContext(suiteContextOptions(sessionPath));
  await disableSceneCanvas(context);
  try {
    const page = await context.newPage();
    await enterGameAsGamemaster(page);
    return await action(page);
  } finally {
    await context.close();
  }
}

/** Joins the world as a passwordless non-GM user. */
export async function joinAsPlayer(page: Page, userName: string): Promise<void> {
  await page.goto("/join");
  await selectJoinUser(page, userName);
  await Promise.all([page.waitForURL(/\/game/, { waitUntil: "commit" }), joinButton(page).click()]);
  await waitForGameReady(page);
  await dismissOverlays(page);
}

/**
 * Enables a module in the running world if it is installed but inactive,
 * reloading so it takes effect.
 *
 * @returns "already_active", "activated", or "not_found"
 */
export async function ensureModuleActive(page: Page, moduleId: string): Promise<string> {
  const status = await page.evaluate(async (id) => {
    const g = globalThis as unknown as {
      game: {
        modules: Map<string, { active: boolean }>;
        settings: {
          get(scope: string, key: string): unknown;
          set(scope: string, key: string, value: unknown): Promise<unknown>;
        };
      };
    };
    const installed = g.game.modules.get(id);
    if (!installed) return "not_found";
    if (installed.active) return "already_active";
    const configuration = g.game.settings.get("core", "moduleConfiguration") as Record<string, boolean>;
    await g.game.settings.set("core", "moduleConfiguration", { ...configuration, [id]: true });
    return "activated";
  }, moduleId);
  if (status === "activated") {
    await page.reload();
    if (page.url().includes("/join")) await joinAsGamemaster(page);
    await waitForGameReady(page);
    await dismissOverlays(page);
  }
  return status;
}

/** Joins the world as the passwordless Gamemaster, from the /join page. */
export async function joinAsGamemaster(page: Page): Promise<void> {
  await selectJoinUser(page, "Gamemaster");
  // Click Join (waits for the button to actually enable).
  const join = joinButton(page);
  await join.waitFor({ state: "visible", timeout: 15_000 });
  await Promise.all([page.waitForURL(/\/game/, { timeout: 90_000, waitUntil: "commit" }), join.click()]);
  await waitForReadyPastPasswordPrompt(page);
  await dismissOverlays(page);
}

/**
 * Picks the user on the join form: a <select> on Foundry 12, an autocomplete
 * textbox on 13+. Waits for either, since the form renders after page load.
 */
async function selectJoinUser(page: Page, userName: string): Promise<void> {
  const userDropdown = joinUserDropdown(page);
  const userTextbox = joinUserTextbox(page);
  await userDropdown
    .or(userTextbox)
    .first()
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {});
  if (await userDropdown.isVisible().catch(() => false)) {
    await userDropdown.selectOption({ label: userName });
    return;
  }
  if (await userTextbox.isVisible().catch(() => false)) await chooseAutocompleteUser(page, userTextbox, userName);
}

/** Chooses the user from the join autocomplete (13+). */
async function chooseAutocompleteUser(page: Page, userTextbox: Locator, userName: string): Promise<void> {
  await userTextbox.click().catch(() => {});
  await userTextbox.fill(userName);
  // click() auto-waits for the suggestion; isVisible() would not.
  const selected = await joinUserSuggestion(page, userName)
    .click({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!selected) {
    // Fallback: keyboard-select the highlighted suggestion.
    await userTextbox.press("ArrowDown").catch(() => {});
    await userTextbox.press("Enter").catch(() => {});
  }
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
    if (Date.now() > deadline) throw new Error("joinAsGamemaster: game never became ready after joining");
  }
}
