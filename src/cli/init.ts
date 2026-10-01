#!/usr/bin/env node
/**
 * `foundry-test init`: scaffolds what a module needs to run integration
 * tests with the kit, reading what it can from module.json. It never
 * overwrites: files and entries that already exist are reported and kept.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONFIG_FILE_NAME } from "../config.js";
import { MIN_SUPPORTED_MAJOR } from "../download/releases.js";
import { isMainModule } from "./is-main.js";

/** The module.json fields init reads. */
export interface ModuleManifest {
  id?: string;
  esmodules?: string[];
  compatibility?: { minimum?: string | number; verified?: string | number; maximum?: string | number };
  relationships?: { systems?: Array<{ id: string }> };
}

/** What init derives from module.json. */
export interface InitPlan {
  config: Record<string, unknown>;
  /** package.json scripts to add: integration, one per older major, coverage. */
  scripts: Record<string, string>;
}

/** The system a test world uses when the module declares none. */
export const SYSTEM_AGNOSTIC_WORLD_SYSTEM = "worldbuilding";

const PLAYWRIGHT_CONFIG_NAMES = ["ts", "mts", "cts", "js", "mjs", "cjs"].map((ext) => `playwright.config.${ext}`);
const GITIGNORE_ENTRIES = [".foundry-test/", "test-results/", ".env"];
const SMOKE_SPEC = "tests/integration/smoke.spec.ts";

/** Builds the config and scripts from a module manifest. */
export function planInit(manifest: ModuleManifest): InitPlan {
  if (!manifest.id) throw new Error('planInit: module.json has no "id"');
  const systems = manifest.relationships?.systems?.map((system) => system.id) ?? [];
  const worldSystems = systems.length > 0 ? systems : [SYSTEM_AGNOSTIC_WORLD_SYSTEM];
  const bundle = manifest.esmodules?.[0]?.replace(/^\.\//, "");
  const config: Record<string, unknown> = {
    moduleId: manifest.id,
    foundryVersion: "latest",
    testWorlds: worldSystems.map((system) => ({ id: `${system}-test`, system })),
    devWorld: { id: `${manifest.id}-dev`, system: worldSystems[0] },
    ...(bundle ? { coverage: { bundle } } : {}),
  };
  return { config, scripts: integrationScripts(supportedMajors(manifest)) };
}

/**
 * The Foundry majors a module supports, from its compatibility range
 * (verified or maximum as the newest), never below what the kit supports.
 */
export function supportedMajors(manifest: ModuleManifest): number[] {
  const major = (version: string | number | undefined) => Number.parseInt(String(version ?? ""), 10);
  const { minimum, verified, maximum } = manifest.compatibility ?? {};
  const newest = major(maximum) || major(verified) || major(minimum);
  if (!newest) return [];
  const oldest = Math.max(major(minimum) || newest, MIN_SUPPORTED_MAJOR);
  return Array.from({ length: Math.max(newest - oldest + 1, 0) }, (_, index) => oldest + index);
}

function integrationScripts(majors: number[]): Record<string, string> {
  const scripts: Record<string, string> = { integration: "foundry-test test run --all-worlds" };
  for (const major of majors.slice(0, -1)) {
    scripts[`integration:v${major}`] = `foundry-test test run --all-worlds --version latest-${major}`;
  }
  scripts["coverage:e2e"] = "foundry-test-coverage";
  return scripts;
}

/** Writes the scaffold into `projectRoot`; returns one line per action. */
export function runInit(projectRoot: string): string[] {
  const manifestPath = join(projectRoot, "module.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`runInit: no module.json in ${projectRoot}; run init from your module's root`);
  }
  const plan = planInit(JSON.parse(readFileSync(manifestPath, "utf8")) as ModuleManifest);
  const moduleId = String(plan.config.moduleId);
  return [
    writeIfMissing(projectRoot, CONFIG_FILE_NAME, `${JSON.stringify(plan.config, null, 2)}\n`),
    writePlaywrightConfig(projectRoot),
    writeIfMissing(projectRoot, SMOKE_SPEC, smokeSpec(moduleId)),
    ...addScripts(projectRoot, plan.scripts),
    ...addGitignoreEntries(projectRoot),
  ];
}

function writeIfMissing(projectRoot: string, relativePath: string, contents: string): string {
  const path = join(projectRoot, relativePath);
  if (existsSync(path)) return `kept     ${relativePath} (already exists)`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  return `created  ${relativePath}`;
}

function writePlaywrightConfig(projectRoot: string): string {
  const existing = PLAYWRIGHT_CONFIG_NAMES.find((name) => existsSync(join(projectRoot, name)));
  if (existing) return `kept     ${existing} (point it at defineFoundryConfig if it does not already)`;
  return writeIfMissing(
    projectRoot,
    "playwright.config.mts",
    `import { defineFoundryConfig } from "@scooper4711/foundry-test-kit";

// One Playwright project per game system in foundry-test.config.json.
export default defineFoundryConfig();
`
  );
}

function smokeSpec(moduleId: string): string {
  return `import { expect, test } from "@scooper4711/foundry-test-kit";

// gmPage is already inside the seeded world as the Gamemaster.
test("the module is active in the seeded world", async ({ gmPage }) => {
  const active = await gmPage.evaluate(
    (id) => (globalThis as unknown as { game: { modules: Map<string, { active: boolean }> } }).game.modules.get(id)?.active,
    ${JSON.stringify(moduleId)}
  );
  expect(active).toBe(true);
});
`;
}

/** Adds the scripts package.json lacks, keeping its indentation. */
function addScripts(projectRoot: string, scripts: Record<string, string>): string[] {
  const path = join(projectRoot, "package.json");
  if (!existsSync(path)) return ["skipped  package.json scripts (no package.json)"];
  const text = readFileSync(path, "utf8");
  const packageJson = JSON.parse(text) as { scripts?: Record<string, string> };
  packageJson.scripts ??= {};
  const report: string[] = [];
  for (const [name, command] of Object.entries(scripts)) {
    if (packageJson.scripts[name]) {
      report.push(`kept     script "${name}" (already defined)`);
      continue;
    }
    packageJson.scripts[name] = command;
    report.push(`added    script "${name}": ${command}`);
  }
  const indent = /^( +|\t)"/m.exec(text)?.[1] ?? "  ";
  writeFileSync(path, `${JSON.stringify(packageJson, null, indent)}\n`);
  return report;
}

function addGitignoreEntries(projectRoot: string): string[] {
  const path = join(projectRoot, ".gitignore");
  const lines = existsSync(path)
    ? readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
    : [];
  const missing = GITIGNORE_ENTRIES.filter((entry) => !lines.includes(entry) && !lines.includes(`/${entry}`));
  if (missing.length === 0) return ["kept     .gitignore (already ignores the kit's files)"];
  const separator = lines.length > 0 && lines.at(-1) !== "" ? "\n" : "";
  appendFileSync(path, `${separator}${missing.join("\n")}\n`);
  return [`added    .gitignore entries: ${missing.join(", ")}`];
}

const NEXT_STEPS = `
Next:
  npm install --save-dev @playwright/test
  npx playwright install chromium
  Put FOUNDRY_LICENSE_KEY (and FOUNDRY_USERNAME / FOUNDRY_PASSWORD, to download
  Foundry) in .env, then: npm run build && npm run integration`;

if (isMainModule(import.meta.url)) {
  try {
    for (const line of runInit(process.cwd())) console.log(line);
    console.log(NEXT_STEPS);
  } catch (failure) {
    console.error(failure instanceof Error ? failure.message : failure);
    process.exit(1);
  }
}
