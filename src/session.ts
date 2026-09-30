/**
 * Entering a world with a saved Gamemaster session, and making sure the
 * module under test is enabled. Joining from /join lives in join.ts.
 */
import type { Browser, Page } from "@playwright/test";
import { disableSceneCanvas, suiteContextOptions } from "./context.js";
import { joinAsGamemaster, waitForGameReady } from "./join.js";
import { dismissOverlays } from "./overlays.js";

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
