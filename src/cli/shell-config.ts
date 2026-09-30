/**
 * Bridge from the JSON config to the `foundry-test` bash CLI.
 *
 *   shell-config.js env                 → KIT_* shell assignments to eval
 *   shell-config.js dotenv              → exports for .env entries not already set
 *   shell-config.js world <id> <field>  → a world's "system" or "title"
 *
 * The world lookup falls back to the dev world, then to the id itself, so
 * ad-hoc worlds (`--world other`) still work.
 */
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
  throw new Error(`shell-config: usage: env | dotenv | world <id> system|title (got: ${argv.join(" ")})`);
}

if (isMainModule(import.meta.url)) {
  process.stdout.write(`${runShellConfig(process.argv.slice(2), loadTestKitConfig(), process.env)}\n`);
}
