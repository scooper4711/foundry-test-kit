#!/usr/bin/env node
/**
 * Foundry VTT builds from foundryvtt.com.
 *
 *   download/cli.js --resolve latest
 *     prints the newest stable version (other versions print unchanged)
 *   download/cli.js --version 14.367 --out .foundry-test/cache/FoundryVTT-Node-14.367.zip
 *     downloads that Node.js build with FOUNDRY_USERNAME / FOUNDRY_PASSWORD
 */
import { parseArgs } from "node:util";
import { isMainModule } from "../cli/is-main.js";
import { downloadFoundryBuild } from "./foundryvtt.js";
import { resolveVersion } from "./releases.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: { resolve: { type: "string" }, version: { type: "string" }, out: { type: "string" } },
  });
  if (values.resolve) {
    console.log(await resolveVersion(values.resolve));
    return;
  }
  const username = process.env.FOUNDRY_USERNAME;
  const password = process.env.FOUNDRY_PASSWORD;
  if (!values.version || !values.out) throw new Error("download: usage: --resolve VER | --version VER --out FILE");
  if (!username || !password) throw new Error("download: set FOUNDRY_USERNAME and FOUNDRY_PASSWORD");
  const version = await resolveVersion(values.version);
  console.log(`Downloading Foundry VTT ${version} (Node.js) from foundryvtt.com as ${username}...`);
  await downloadFoundryBuild({ username, password }, version, values.out);
  console.log(`Saved ${values.out}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((failure: unknown) => {
    console.error(failure instanceof Error ? failure.message : failure);
    process.exit(1);
  });
}
