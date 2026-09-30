/**
 * The per-project test kit configuration, read from `foundry-test.config.json`
 * at the project root. Everything a project used to hard-code into its own
 * copy of the harness (module id, worlds, seeding extras) lives here.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const CONFIG_FILE_NAME = "foundry-test.config.json";

export interface WorldConfig {
  /** World directory name, e.g. "integration-test". */
  id: string;
  /** Game system id the world is created with, e.g. "pf2e". */
  system: string;
  /** World title shown in Foundry; defaults to the id. */
  title: string;
}

/** A module setting written into freshly seeded worlds. */
export interface SeedSetting {
  key: string;
  /** Literal value to store. */
  value?: unknown;
  /** Environment variable to read the value from (skipped when unset). */
  fromEnv?: string;
}

export interface TestKitConfig {
  /** The Foundry module under test (its directory under Data/modules). */
  moduleId: string;
  /** Default Foundry server version, e.g. "14.367". */
  foundryVersion: string;
  /** Worlds the integration suite runs against, one Playwright project per system. */
  testWorlds: WorldConfig[];
  /** World the dev server boots into. */
  devWorld: WorldConfig;
  /** Game systems installed in every seeded data directory. */
  systems: string[];
  seed: { settings: SeedSetting[] };
  coverage: { bundle: string };
  /** Absolute path of the directory holding the config file. */
  projectRoot: string;
}

type RawConfig = Partial<Omit<TestKitConfig, "testWorlds" | "devWorld" | "projectRoot">> & {
  testWorlds?: Partial<WorldConfig>[];
  devWorld?: Partial<WorldConfig>;
};

const DEFAULT_TEST_WORLD: WorldConfig = { id: "integration-test", system: "pf2e", title: "Integration Test" };
const DEFAULT_DEV_WORLD: WorldConfig = { id: "dev-test", system: "pf2e", title: "Dev Test" };

/**
 * Finds and parses the project's config file, searching upward from
 * `startDirectory` (or `FOUNDRY_TEST_ROOT` when set).
 */
export function loadTestKitConfig(startDirectory: string = process.cwd()): TestKitConfig {
  const configPath = findConfigFile(process.env.FOUNDRY_TEST_ROOT ?? startDirectory);
  if (!configPath) {
    throw new Error(`loadTestKitConfig: no ${CONFIG_FILE_NAME} found in ${startDirectory} or its parents`);
  }
  let raw: RawConfig;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8")) as RawConfig;
  } catch (cause) {
    throw new Error(`loadTestKitConfig: ${configPath} is not valid JSON`, { cause });
  }
  return normalizeConfig(raw, dirname(configPath));
}

/** Fills defaults and validates a parsed config file. */
export function normalizeConfig(raw: RawConfig, projectRoot: string): TestKitConfig {
  if (!raw.moduleId) {
    throw new Error(`normalizeConfig: ${CONFIG_FILE_NAME} must set "moduleId"`);
  }
  const testWorlds = (raw.testWorlds?.length ? raw.testWorlds : [DEFAULT_TEST_WORLD]).map(toWorld);
  const devWorld = toWorld({ ...DEFAULT_DEV_WORLD, ...raw.devWorld });
  return {
    moduleId: raw.moduleId,
    foundryVersion: raw.foundryVersion ?? "14.367",
    testWorlds,
    devWorld,
    systems: raw.systems?.length ? raw.systems : uniqueSystems([...testWorlds, devWorld]),
    seed: { settings: raw.seed?.settings ?? [] },
    coverage: { bundle: raw.coverage?.bundle ?? "dist/main.js" },
    projectRoot: resolve(projectRoot),
  };
}

function toWorld(world: Partial<WorldConfig>): WorldConfig {
  if (!world.id) throw new Error('normalizeConfig: every world needs an "id"');
  return { id: world.id, system: world.system ?? "pf2e", title: world.title ?? world.id };
}

function uniqueSystems(worlds: WorldConfig[]): string[] {
  return [...new Set(worlds.map((world) => world.system))];
}

function findConfigFile(startDirectory: string): string | undefined {
  let directory = resolve(startDirectory);
  for (;;) {
    const candidate = join(directory, CONFIG_FILE_NAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}
