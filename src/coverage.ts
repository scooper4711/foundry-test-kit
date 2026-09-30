/**
 * Chromium V8 coverage of the module's bundle, recorded per page and written
 * to coverage/e2e-raw/ for the `foundry-test-coverage` report.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { loadTestKitConfig } from "./config.js";

/** Raw chunk directory, relative to the project root. */
export const COVERAGE_RAW_DIR = "coverage/e2e-raw";

/** URL fragment identifying the module's bundle, e.g. "my-module/dist/main.js". */
export function moduleBundleMarker(): string {
  const config = loadTestKitConfig();
  return `${config.moduleId}/${config.coverage.bundle}`;
}

/**
 * Begins Chromium JS coverage on the page. Must run before navigation so
 * module init is captured; `resetOnNavigation: false` keeps counting across
 * the /join → /game hop. No-op outside Chromium.
 */
export async function startCoverage(page: Page): Promise<void> {
  await page.coverage?.startJSCoverage({ resetOnNavigation: false }).catch(() => {});
}

/**
 * Stops coverage and writes this page's raw V8 ranges for the module bundle
 * to `coverage/e2e-raw/<name>.json`. Pages that never loaded the bundle
 * write nothing.
 */
export async function stopCoverage(page: Page, name: string): Promise<void> {
  const entries = await page.coverage?.stopJSCoverage().catch(() => undefined);
  if (!entries) return;
  const marker = moduleBundleMarker();
  const ours = entries.filter((entry) => entry.url.includes(marker));
  if (ours.length === 0) return;
  const directory = resolve(loadTestKitConfig().projectRoot, COVERAGE_RAW_DIR);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, `${name}.json`),
    JSON.stringify(ours.map(({ url, functions }) => ({ url, functions })))
  );
}

/** A filesystem-safe coverage chunk name for a test. */
export function coverageChunkName(projectName: string, testFile: string, testTitle: string): string {
  const file = testFile.split("/").pop() ?? "spec";
  const title = testTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 60);
  return `${projectName}-${file}-${title}`;
}
