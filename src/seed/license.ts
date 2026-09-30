/**
 * Seeding phase 1: get from a fresh server to the setup screen — license
 * key, EULA, and administrator login, in whatever order Foundry asks.
 */
import type { Page } from "@playwright/test";
import { adminPasswordField } from "../foundry-ui.js";
import { dismissOverlays, ensureAdminAccess } from "../overlays.js";
import { log, type SeedOptions } from "./options.js";

const MAX_ATTEMPTS = 5;
const ARRIVED = /\/(setup|game|join)/;

/** Walks the license/EULA/auth pages until setup (or a launched world) is reached. */
export async function reachSetup(page: Page, options: SeedOptions): Promise<void> {
  await page.goto(options.baseUrl);
  await page.waitForTimeout(2000);
  let licensed = false;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !ARRIVED.test(page.url()); attempt++) {
    if (page.url().includes("/license")) {
      licensed = (await handleLicensePage(page, options.licenseKey)) || licensed;
    } else if (page.url().includes("/auth")) {
      await logInAsAdmin(page, options.adminPassword);
    } else {
      await page.waitForTimeout(3000);
    }
  }
  await page.waitForURL(ARRIVED, { timeout: 30_000 });
  log(`-> Reached: ${page.url()}`);
  log(licensed ? ">>> License installed" : ">>> License already installed");

  // Administrator access can arrive as the /auth page or as a dialog over
  // setup itself. First-run tours render a beat after setup loads, after an
  // initial dismiss that finds nothing, so clear twice with a gap.
  await ensureAdminAccess(page, options.adminPassword);
  log("-> Clearing first-run dialogs...");
  await dismissOverlays(page);
  await page.waitForTimeout(500);
  await dismissOverlays(page);
}

/** Enters the key or accepts the EULA; returns whether it changed anything. */
async function handleLicensePage(page: Page, licenseKey: string): Promise<boolean> {
  const keyInput = page.getByPlaceholder("XXXX-XXXX-XXXX-XXXX-XXXX-XXXX");
  if (await keyInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    log("-> Entering license key...");
    await keyInput.fill(licenseKey);
    await page.getByRole("button", { name: "Submit Key" }).click();
    await keyInput.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
    return true;
  }
  const eula = page.getByRole("checkbox", { name: "I agree to these terms" });
  if (await eula.isVisible({ timeout: 3000 }).catch(() => false)) {
    log("-> Accepting EULA...");
    await eula.click();
    await page.getByRole("button", { name: "Agree" }).click();
    await eula.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
    return true;
  }
  log("-> On /license but nothing to act on yet, waiting...");
  await page.waitForTimeout(5000);
  await page.reload();
  await page.waitForTimeout(3000);
  return false;
}

async function logInAsAdmin(page: Page, adminPassword: string): Promise<void> {
  log("-> Logging in as admin...");
  const passwordField = adminPasswordField(page);
  await passwordField.fill(adminPassword);
  await passwordField.press("Enter");
  await passwordField.waitFor({ state: "hidden", timeout: 30_000 }).catch(() => {});
}
