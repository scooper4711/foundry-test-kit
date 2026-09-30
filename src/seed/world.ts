/**
 * Seeding phases 3 and 4: create the test world (riding out the template
 * picker and the first-run data migration), then launch it.
 */
import type { Page } from "@playwright/test";
import { dismissOverlays } from "../overlays.js";
import { log, systemDisplayName } from "./options.js";

const CREATION_TIMEOUT_MS = 300_000;

export async function createWorld(page: Page, worldTitle: string, worldSystem: string): Promise<void> {
  log(`>>> Creating world "${worldTitle}" (${systemDisplayName(worldSystem)})...`);
  await page.getByRole("heading", { name: "Game Worlds" }).click();
  await page.waitForTimeout(1000);
  if (await page.locator("article", { hasText: worldTitle }).isVisible({ timeout: 2000 }).catch(() => false)) {
    log(">>> World already exists.");
    return;
  }
  await page.getByRole("button", { name: "Create World" }).click();
  await page.waitForTimeout(2000);
  // The setup form uses plain divs as captions, so getByLabel() cannot
  // associate them — anchor on the caption text instead.
  const titleField = page.getByText("World Title", { exact: true }).locator("xpath=..").getByRole("textbox");
  await titleField.fill(worldTitle, { timeout: 30_000 });
  await page.getByRole("listitem").filter({ hasText: systemDisplayName(worldSystem) }).click({ timeout: 30_000 });
  await page.getByRole("button", { name: "Continue", exact: true }).click({ timeout: 30_000 });
  await pickBlankTemplate(page);
  await page.waitForTimeout(3000);
  await waitForCreation(page);
  log(">>> World created.");
}

/** Creation can land on a template picker (/create): choose Blank World. */
async function pickBlankTemplate(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 2 && page.url().includes("/create"); attempt++) {
    const picked = await page
      .evaluate(() => {
        const heading = [...document.querySelectorAll("h1, h2, h3, h4")].find(
          (element) => (element.textContent ?? "").trim() === "Blank World"
        );
        let node = heading?.parentElement ?? null;
        while (node && node !== document.body) {
          if (node.matches("button, a, [data-action], article, li")) {
            (node as HTMLElement).click();
            return `clicked:${node.tagName}`;
          }
          node = node.parentElement;
        }
        return heading ? "no-clickable-ancestor" : "no-heading";
      })
      .catch(() => "evaluate-failed");
    log(`[seed] template pick: ${picked}`);
    await page.waitForTimeout(3000);
  }
}

/**
 * Submitting creation kicks off a data migration that can take minutes on a
 * fresh world; wait for setup to leave /create, logging migration progress.
 */
async function waitForCreation(page: Page): Promise<void> {
  log("[seed] waiting for world creation + migration...");
  const deadline = Date.now() + CREATION_TIMEOUT_MS;
  while (page.url().includes("/create") && !(await creationMovedOn(page))) {
    const notes = await page
      .evaluate(() => [...document.querySelectorAll("#notifications li")].map((el) => (el.textContent ?? "").slice(0, 120)))
      .catch(() => [] as string[]);
    const migrating = notes.find((text) => /migrat/i.test(text));
    if (migrating) log(`[seed] ${migrating}`);
    if (Date.now() > deadline) {
      throw new Error("waitForCreation: world creation did not finish (still on /create after 5 minutes)");
    }
    await page.waitForTimeout(10_000);
  }
}

/** Creation may finish into the worlds list or user management (same URL). */
async function creationMovedOn(page: Page): Promise<boolean> {
  const worlds = page.getByRole("heading", { name: "Game Worlds" });
  const saveAndContinue = page.getByRole("button", { name: "Save and Continue" });
  return (
    (await worlds.isVisible({ timeout: 2000 }).catch(() => false)) ||
    (await saveAndContinue.isVisible({ timeout: 2000 }).catch(() => false))
  );
}

/**
 * Launches the world. First entry to a brand-new world can land straight in
 * /game — and a save click can navigate there mid-flow — so wait for either
 * destination rather than trusting one URL read.
 */
export async function launchWorld(page: Page, worldTitle: string): Promise<void> {
  if (!page.url().includes("/game")) await saveUserManagement(page);
  if (page.url().includes("/game")) {
    log("-> Already in game after creation.");
    // First entry starts another tour a beat after load; catch late starters.
    await dismissOverlays(page);
    await page.waitForTimeout(5000);
    await dismissOverlays(page);
    return;
  }
  log("-> Launching test world...");
  await page.getByRole("heading", { name: "Game Worlds" }).click({ timeout: 30_000 });
  await page.waitForTimeout(2000);
  const launch = page
    .locator("article", { hasText: worldTitle })
    .locator("[data-action='worldLaunch'], button:has-text('Launch')");
  await launch.first().click({ timeout: 60_000 });
  await page.waitForURL(/\/(join|game)/, { timeout: 60_000 });
  log("-> World launched.");
}

/** Saves through User Management (form#manage-players) when creation lands there. */
async function saveUserManagement(page: Page): Promise<void> {
  const save = page.getByRole("button", { name: "Save and Continue" });
  if (await save.isVisible({ timeout: 5000 }).catch(() => false)) {
    await save.click({ timeout: 30_000 });
    await page.waitForTimeout(3000);
  }
  const arrived = await page
    .waitForFunction(
      () =>
        location.href.includes("/game") ||
        [...document.querySelectorAll("h1, h2, h3")].some((el) => (el.textContent ?? "").trim() === "Game Worlds"),
      { timeout: 60_000 }
    )
    .then(() => true)
    .catch(() => false);
  if (arrived) return;
  const state = await page
    .evaluate(() => ({
      url: location.href,
      headings: [...document.querySelectorAll("h1, h2, h3, h4")]
        .map((el) => (el.textContent ?? "").trim())
        .filter(Boolean)
        .slice(0, 10),
    }))
    .catch(() => null);
  throw new Error(`saveUserManagement: reached neither game nor worlds list (${JSON.stringify(state)})`);
}
