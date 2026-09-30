/**
 * Browser context setup shared by the fixtures and by any context a spec
 * opens itself (which does not inherit playwright.config `use` settings).
 */
import type { BrowserContext, BrowserContextOptions, Page } from "@playwright/test";

/** Foundry warns and degrades below 1366x768; headless defaults to 1280x720. */
export const FOUNDRY_VIEWPORT = { width: 1600, height: 900 };

/** Base URL of the test server, from FOUNDRY_TEST_PORT (default 30001). */
export function testBaseUrl(): string {
  return `http://localhost:${process.env.FOUNDRY_TEST_PORT ?? "30001"}`;
}

/** Same base URL and viewport as the configured `page` fixture. */
export function suiteContextOptions(storageState?: string): BrowserContextOptions {
  return { baseURL: testBaseUrl(), viewport: FOUNDRY_VIEWPORT, storageState };
}

/**
 * Boots Foundry without its scene canvas in every page of the context (or
 * on one page). Headless Chromium renders the WebGL scene in software, which
 * keeps the main thread so busy that every action takes seconds. Use it
 * unless a spec drives system UI that reads `canvas` (PF2e's sheets and
 * actor directory do).
 */
export async function disableSceneCanvas(target: BrowserContext | Page): Promise<void> {
  // Client-scoped settings are read from localStorage as JSON.
  await target.addInitScript(() => window.localStorage.setItem("core.noCanvas", "true"));
}
