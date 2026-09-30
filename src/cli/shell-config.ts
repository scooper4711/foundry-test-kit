/**
 * Bridge from the JSON config to the `foundry-test` bash CLI.
 *
 *   shell-config.js env                 → KIT_* shell assignments to eval
 *   shell-config.js dotenv              → exports for .env entries not already set
 *   shell-config.js world <id> <field>  → a world's "system" or "title"
 *   shell-config.js seed-hash <id>      → fingerprint of what seeding a world applies
 *
 * The world lookup falls back to the dev world, then to the id itself, so
 * ad-hoc worlds (`--world other`) still work.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";
import { loadTestKitConfig, type TestKitConfig, type WorldConfig } from "../config.js";
import { isMainModule } from "./is-main.js";

/** Quotes a value for safe use in a POSIX shell assignment. */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Renders the config as KIT_* shell variable assignments. */
export function renderShellEnv(config: TestKitConfig): string {
  const variables: Record<string, string> = {
    KIT_MODULE_ID: config.moduleId,
    KIT_FOUNDRY_VERSION: config.foundryVersion,
    KIT_PROJECT_ROOT: config.projectRoot,
    KIT_TEST_WORLDS: config.testWorlds.map((world) => `${world.id}:${world.system}`).join(" "),
    KIT_DEV_WORLD: config.devWorld.id,
    KIT_SYSTEMS: config.systems.join(","),
    KIT_BUNDLE: config.coverage.bundle,
    KIT_WORK_DIR: config.workDir,
  };
  return Object.entries(variables)
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join("\n");
}

/**
 * Renders `export` lines for .env entries whose variables are not already
 * set. Never overriding the environment is what makes encrypted .env files
 * work: run through `dotenvx run -- ...`, the decrypted values are already
 * in the environment and the encrypted strings in the file are ignored.
 */
export function renderDotEnvExports(dotEnvText: string, env: NodeJS.ProcessEnv): string {
  return Object.entries(parse(dotEnvText))
    .filter(([name]) => env[name] === undefined && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    .map(([name, value]) => `export ${name}=${shellQuote(value)}`)
    .join("\n");
}

/** Looks up a field of a configured world by id. */
export function worldField(config: TestKitConfig, worldId: string, field: "system" | "title"): string {
  const world: WorldConfig | undefined = [...config.testWorlds, config.devWorld].find(
    (candidate) => candidate.id === worldId
  );
  if (world) return world[field];
  return field === "system" ? (config.testWorlds[0]?.system ?? "pf2e") : worldId;
}

/**
 * Fingerprints everything seeding a world applies (its system and title,
 * the installed systems, the module, settings and users), so the CLI can
 * re-seed when the config changes instead of trusting an old seed.
 */
export function seedHash(config: TestKitConfig, worldId: string): string {
  const seeded = {
    world: { id: worldId, system: worldField(config, worldId, "system"), title: worldField(config, worldId, "title") },
    systems: config.systems,
    moduleId: config.moduleId,
    seed: config.seed,
  };
  return createHash("sha256").update(JSON.stringify(seeded)).digest("hex").slice(0, 16);
}

/** Runs a shell-config command, returning its output. */
export function runShellConfig(argv: string[], config: TestKitConfig, env: NodeJS.ProcessEnv): string {
  const [command, worldId, field] = argv;
  if (command === "env") return renderShellEnv(config);
  if (command === "dotenv") {
    const dotEnvPath = join(config.projectRoot, ".env");
    return existsSync(dotEnvPath) ? renderDotEnvExports(readFileSync(dotEnvPath, "utf8"), env) : "";
  }
  if (command === "world" && worldId && (field === "system" || field === "title")) {
    return worldField(config, worldId, field);
  }
  if (command === "seed-hash" && worldId) return seedHash(config, worldId);
  throw new Error(
    `shell-config: usage: env | dotenv | world <id> system|title | seed-hash <id> (got: ${argv.join(" ")})`
  );
}

if (isMainModule(import.meta.url)) {
  process.stdout.write(`${runShellConfig(process.argv.slice(2), loadTestKitConfig(), process.env)}\n`);
}
