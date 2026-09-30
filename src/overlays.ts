/**
 * Clearing Foundry's first-run popups (tours, welcome and usage-data
 * dialogs) and administrator password prompts. These appear on a clean data
 * directory but never on the second run, the classic clean-checkout flake.
 */
import type { Locator, Page } from "@playwright/test";
import { adminPasswordField } from "./foundry-ui.js";

/** Button labels that unambiguously dismiss (never accept) a popup. */
const DISMISS_BUTTON_NAMES = [
  "Close Window",
  "Close",
  "Dismiss",
  "Decline",
  "Decline Sharing",
  "No",
  "End Tour",
  "Got it",
  "Don't Show Again",
];

/** How long to wait for an overlay to appear before proceeding. */
const OVERLAY_WAIT_MS = 5000;

/** Hard cap on dismiss rounds per call so a popup storm can't hang setup. */
const OVERLAY_MAX_ROUNDS = 12;

export async function dismissTours(page: Page): Promise<void> {
  // Any of these visible means a tour is up (tooltip, centered step, or dim
  // overlay). Wait for one to appear; if none does, there is nothing to do.
  // After dismissing, wait for the next — tours can chain.
  const TOUR_SELECTORS = [".tour", ".tour-center-step", ".tour-overlay", "#tooltip.tour"];
  for (let round = 0; round < OVERLAY_MAX_ROUNDS; round++) {
    const appeared = await page
      .locator(TOUR_SELECTORS.join(", "))
      .first()
      .waitFor({ state: "visible", timeout: OVERLAY_WAIT_MS })
      .then(() => true)
      .catch(() => false);
    if (!appeared) return;
    await page
      .evaluate(() => {
        const Ns = (globalThis as unknown as { foundry?: { nue?: { Tour?: unknown } } }).foundry?.nue?.Tour as
          { tourInProgress: boolean; activeTour?: { exit: () => void } | null } | undefined;
        if (Ns?.tourInProgress) Ns.activeTour?.exit();
        document.querySelectorAll(".tour-overlay, .tour-center-step").forEach((el) => el.remove());
      })
      .catch(() => {});
    const tourExit = page.locator('.tour [data-action="exit"], .tour-center-step [data-action="exit"]').first();
    if (await tourExit.isVisible({ timeout: 1000 }).catch(() => false)) {
      await tourExit.click().catch(() => {});
      await page.waitForFunction(() => !document.querySelector(".tour"), { timeout: 2000 }).catch(() => {});
    }
  }
}

/**
 * Clears first-run popups (NUE tours, welcome/what's-new dialogs, usage-data
 * prompts). These appear on a clean data dir but never on the second run,
 * which is the classic clean-checkout flake source. Only ever *dismisses* —
 * never clicks OK/Accept/Join — and is only used during login/setup, never
 * while a test dialog of our own might be open.
 */
export async function dismissOverlays(page: Page): Promise<void> {
  // Tours first: they can cover everything else.
  await dismissTours(page);
  // Then clear popups one at a time, dismiss buttons before toast
  // notifications: a permanent notification (Foundry 12 on a newer Node
  // shows one) is re-rendered after removal and must not use up every round.
  let notificationClears = 0;
  for (let round = 0; round < OVERLAY_MAX_ROUNDS; round++) {
    const found = await nextOverlay(page, notificationClears < MAX_NOTIFICATION_CLEARS);
    if (found === null) return;
    if (found === NOTIFICATIONS) {
      notificationClears += 1;
      await page
        .evaluate(() => document.querySelectorAll("#notifications li").forEach((el) => el.remove()))
        .catch(() => {});
      continue;
    }
    await dismissButton(page, found)
      .click({ timeout: 2000 })
      .catch(() => {});
  }
}

/**
 * A visible button whose text is exactly `label`. Matched on text content,
 * not accessible name: icon glyphs (Font Awesome ::before content) end up in
 * Chromium's accessible names, so getByRole(name) misses buttons like
 * Foundry 12's "Decline Sharing".
 */
function dismissButton(page: Page, label: string): Locator {
  const exactText = new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`);
  return page.locator("button:visible", { hasText: exactText }).first();
}

const NOTIFICATIONS = "notifications";
/** Toast clears per call; permanent toasts come straight back. */
const MAX_NOTIFICATION_CLEARS = 2;

/**
 * Waits for the next thing to dismiss: the label of a visible dismiss
 * button, else "notifications" (when `includeNotifications`), else null once
 * nothing appears within the wait.
 */
async function nextOverlay(page: Page, includeNotifications: boolean): Promise<string | null> {
  return page
    .waitForFunction(
      ({ names, notifications }) => {
        for (const button of Array.from(document.querySelectorAll("button"))) {
          const label = (button.textContent ?? "").trim();
          const rect = button.getBoundingClientRect();
          if (names.includes(label) && rect.width > 0 && rect.height > 0) return label;
        }
        return notifications && document.querySelector("#notifications li") ? "notifications" : null;
      },
      { names: DISMISS_BUTTON_NAMES, notifications: includeNotifications },
      { timeout: OVERLAY_WAIT_MS }
    )
    .then((handle) => handle.jsonValue() as Promise<string>)
    .catch(() => null);
}

/**
 * Ensures administrator access, whether it arrives as the /auth login
 * page or as an "administrator access required" dialog over setup.
 * Actively polls for the password field instead of assuming a fixed
 * sequence: fills it, submits, and waits until it is gone. Resolves
 * immediately when no password prompt is present.
 */
export async function ensureAdminAccess(page: Page, password: string): Promise<void> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const field = adminPasswordField(page);
    const visible = await field.isVisible({ timeout: 2000 }).catch(() => false);
    if (!visible) {
      // Re-check once after a beat: the dialog can pop late.
      await page.waitForTimeout(1000);
      if (await field.isVisible({ timeout: 1000 }).catch(() => false)) {
        continue;
      }
      return;
    }
    await field.fill(password);
    await field.press("Enter").catch(() => {});
    await field.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
    if (Date.now() > deadline) {
      throw new Error("administrator access prompt never cleared");
    }
  }
}

/**
 * Clicks a setup-screen control, clearing any popup that intercepts the
 * click (Foundry 12 and 13 raise their usage-data prompt a few seconds after
 * setup loads, so dismissing up front can miss it) and retrying.
 */
export async function clickPastPopups(page: Page, target: Locator, attempts = 4): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const clicked = await target.click({ timeout: 10_000 }).then(
      () => true,
      () => false
    );
    if (clicked) return;
    if (attempt >= attempts) throw new Error(`clickPastPopups: could not click ${target} after ${attempts} attempts`);
    await dismissOverlays(page);
  }
}
