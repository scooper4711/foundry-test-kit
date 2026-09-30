/**
 * Clearing Foundry's first-run popups (tours, welcome and usage-data
 * dialogs) and administrator password prompts. These appear on a clean data
 * directory but never on the second run, the classic clean-checkout flake.
 */
import type { Page } from "@playwright/test";

/** Button labels that unambiguously dismiss (never accept) a popup. */
const DISMISS_BUTTON_NAMES = [
  'Close Window',
  'Close',
  'Dismiss',
  'Decline',
  'Decline Sharing',
  'No',
  'End Tour',
  'Got it',
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
  const TOUR_SELECTORS = ['.tour', '.tour-center-step', '.tour-overlay', '#tooltip.tour'];
  for (let round = 0; round < OVERLAY_MAX_ROUNDS; round++) {
    const appeared = await page
      .locator(TOUR_SELECTORS.join(', '))
      .first()
      .waitFor({ state: 'visible', timeout: OVERLAY_WAIT_MS })
      .then(() => true)
      .catch(() => false);
    if (!appeared) return;
    await page
      .evaluate(() => {
        const Ns = (globalThis as unknown as { foundry?: { nue?: { Tour?: unknown } } }).foundry?.nue?.Tour as
          { tourInProgress: boolean; activeTour?: { exit: () => void } | null } | undefined;
        if (Ns?.tourInProgress) Ns.activeTour?.exit();
        document.querySelectorAll('.tour-overlay, .tour-center-step').forEach((el) => el.remove());
      })
      .catch(() => {});
    const tourExit = page.locator('.tour [data-action="exit"], .tour-center-step [data-action="exit"]').first();
    if (await tourExit.isVisible({ timeout: 1000 }).catch(() => false)) {
      await tourExit.click().catch(() => {});
      await page.waitForFunction(() => !document.querySelector('.tour'), { timeout: 2000 }).catch(() => {});
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
  // Then wait for dismissable popups one at a time: toast notifications
  // or buttons whose label unambiguously dismisses. No popup within the
  // wait means the UI is clear.
  for (let round = 0; round < OVERLAY_MAX_ROUNDS; round++) {
    const found: string | null = await page
      .waitForFunction(
        (names: string[]) => {
          if (document.querySelector('#notifications li')) return 'notifications';
          const buttons = Array.from(document.querySelectorAll('button'));
          for (const button of buttons) {
            const label = (button.textContent ?? '').trim();
            if (!names.includes(label)) continue;
            const rect = button.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) return label;
          }
          return null;
        },
        DISMISS_BUTTON_NAMES,
        { timeout: OVERLAY_WAIT_MS }
      )
      .then((handle) => handle.jsonValue())
      .catch(() => null);
    if (found === null) return;
    if (found === 'notifications') {
      await page
        .evaluate(() => {
          document.querySelectorAll('#notifications li').forEach((el) => el.remove());
        })
        .catch(() => {});
      continue;
    }
    const button = page.getByRole('button', { name: found, exact: true });
    if (await button.isVisible({ timeout: 1000 }).catch(() => false)) {
      await button.click().catch(() => {});
    }
  }
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
    const field = page.getByRole('textbox', { name: 'Administrator Password' });
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
    const login = page.getByRole('button', { name: 'Log In' });
    if (await login.isVisible({ timeout: 2000 }).catch(() => false)) {
      await login.click().catch(() => {});
    }
    await field.waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
    if (Date.now() > deadline) {
      throw new Error('administrator access prompt never cleared');
    }
  }
}

