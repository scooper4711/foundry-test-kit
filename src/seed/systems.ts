/**
 * Seeding phase 2: install each requested game system from the setup
 * screen's package installer (skipping ones already installed).
 */
import type { Locator, Page } from "@playwright/test";
import { dismissTours } from "../overlays.js";
import { log, systemDisplayName } from "./options.js";

const INSTALL_TIMEOUT_MS = 300_000;

export async function installSystems(page: Page, systemIds: string[]): Promise<void> {
  for (const systemId of systemIds) {
    const systemName = systemDisplayName(systemId);
    log(`-> Checking for ${systemName} system...`);
    await page.getByRole("heading", { name: "Game Systems" }).click();
    await page.waitForTimeout(1000);
    const installed = await page
      .locator("article", { hasText: systemName })
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    if (installed) {
      log(`>>> ${systemName} system already installed.`);
      continue;
    }
    await installSystem(page, systemId, systemName);
    await closeInstaller(page);
  }
}

async function installSystem(page: Page, systemId: string, systemName: string): Promise<void> {
  log(`>>> Downloading ${systemName} system (this may take a few minutes)...`);
  // Tours only here: a broad dismiss could click the installer's own Close.
  await dismissTours(page);
  await page.getByRole("button", { name: "Install System" }).click({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  await dismissTours(page);
  await page.getByRole("searchbox", { name: "Filter" }).fill(systemId);

  // The remote list resolves asynchronously — wait for the article itself.
  const article = page.locator(`[data-package-id='${systemId}']`);
  await article.waitFor({ state: "visible", timeout: 60_000 });
  const installButton = article.getByRole("button", { name: "Install" });
  if (!(await installButton.isVisible({ timeout: 5000 }).catch(() => false))) {
    log(`-> ${systemName} already installed (in dialog).`);
    return;
  }
  const finished = waitForInstallFinished(page, article);
  await clickThroughTours(page, installButton, systemName);
  log(`-> ${systemName} download started (this may take a few minutes)...`);
  if ((await finished) === "missed") {
    throw new Error(`installSystem: ${systemName} reported neither console success nor an Installed button`);
  }
  log(`>>> ${systemName} system ready.`);
  await dismissTours(page);
}

/**
 * Resolves when the install reports "installed successfully" on the console
 * or the Installed button appears (whichever reaches the page), or "missed".
 * Must be started before clicking Install.
 */
function waitForInstallFinished(page: Page, article: Locator): Promise<string> {
  const quiet = (signal: Promise<string>) => signal.catch(() => "missed");
  const consoleMessage = quiet(
    page
      .waitForEvent("console", {
        predicate: (message) => /installed successfully/i.test(message.text()),
        timeout: INSTALL_TIMEOUT_MS,
      })
      .then(() => "console")
  );
  const installedButton = quiet(
    article
      .getByRole("button", { name: "Installed" })
      .waitFor({ timeout: INSTALL_TIMEOUT_MS })
      .then(() => "button")
  );
  return Promise.race([consoleMessage, installedButton]);
}

/** Overlays can cover the button mid-render: clear tours and retry the click. */
async function clickThroughTours(page: Page, button: Locator, systemName: string): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await dismissTours(page);
    if (
      await button.click({ timeout: 30_000 }).then(
        () => true,
        () => false
      )
    )
      return;
  }
  throw new Error(`clickThroughTours: could not click the ${systemName} Install button (covered or detached)`);
}

/**
 * Closes the install dialog (form#install-package, whose header close is a
 * real button) and verifies it went away, since a stale dialog blocks
 * everything after it. Dumps the dialog markup when it will not close.
 */
async function closeInstaller(page: Page): Promise<void> {
  const installer = page.locator(
    "form#install-package, .window-app:has([data-package-id]), dialog:has([data-package-id])"
  );
  const headerClose = page
    .locator(
      'form#install-package header button[data-action="close"], ' +
        ".window-app .window-header a.header-button:has(i.fa-xmark), " +
        ".window-app .window-header a.header-button:has(i.fa-times), " +
        ".window-app .header-control.fa-xmark, dialog .header-control"
    )
    .first();
  const labeledClose = installer.getByRole("button", { name: /^(Done|Close|OK|Finished)$/ }).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!(await installer.isVisible({ timeout: 2000 }).catch(() => false))) return;
    await dismissTours(page);
    for (const close of [headerClose, labeledClose]) {
      if (await close.isVisible({ timeout: 2000 }).catch(() => false)) {
        await close.click().catch(() => {});
        await page.waitForTimeout(1000);
      }
    }
  }
  if (!(await installer.isVisible({ timeout: 2000 }).catch(() => false))) return;
  const markup = await page
    .evaluate(() =>
      [...document.querySelectorAll("dialog, .window-app, form.application")]
        .map((element) => element.outerHTML.slice(0, 1500))
        .join("\n---\n")
    )
    .catch(() => "<unreadable>");
  log(`Installer dialog markup:\n${markup}`);
  throw new Error("closeInstaller: installer dialog did not close after system install (markup dumped above)");
}
