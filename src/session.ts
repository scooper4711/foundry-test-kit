/**
 * Joining a Foundry world as a given user and waiting for the game to be
 * ready, plus making sure the module under test is enabled.
 */
import type { Browser, Page } from "@playwright/test";
import { disableSceneCanvas, suiteContextOptions } from "./context.js";
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
  const userSelect = page.getByRole("textbox", { name: "Select User" });
  await userSelect.fill(userName);
  await page.locator("#autocomplete li", { hasText: new RegExp(`^${userName}$`) }).click();
  await Promise.all([
    page.waitForURL(/\/game/, { waitUntil: "commit" }),
    page.getByRole("button", { name: "Join Game Session" }).click(),
  ]);
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
  await selectGamemaster(page);
  // Click Join (waits for the button to actually enable).
  const joinButton = page.getByRole("button", { name: "Join Game Session" });
  await joinButton.waitFor({ state: "visible", timeout: 15_000 });
  await Promise.all([page.waitForURL(/\/game/, { timeout: 90_000, waitUntil: "commit" }), joinButton.click()]);
  await waitForReadyPastPasswordPrompt(page);
  await dismissOverlays(page);
}

/**
 * Selects Gamemaster in the join form's user autocomplete. The option is an
 * <li> inside #autocomplete (NOT the wrapping <menu>, whose text also
 * matches) — clicking the wrapper selects nothing and Join silently does
 * nothing.
 */
async function selectGamemaster(page: Page): Promise<void> {
  const userSelect = page.getByRole("textbox", { name: "Select User" });
  // waitFor (not isVisible): the form renders async after page load, and
  // isVisible() does not wait — gating on it skips user selection entirely.
  await userSelect.waitFor({ state: "visible", timeout: 30_000 }).catch(() => {});
  if (!(await userSelect.isVisible().catch(() => false))) return;
  await userSelect.click().catch(() => {});
  await userSelect.fill("Gamemaster");
  // click() auto-waits for the suggestion; isVisible() would not.
  const selected = await page
    .locator("#autocomplete li", { hasText: /^Gamemaster$/ })
    .click({ timeout: 10_000 })
    .then(() => true)
    .catch(() => false);
  if (!selected) {
    // Fallback: keyboard-select the highlighted suggestion.
    await userSelect.press("ArrowDown").catch(() => {});
    await userSelect.press("Enter").catch(() => {});
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
