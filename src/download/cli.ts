#!/usr/bin/env node
/**
 * Downloads a Foundry VTT Node.js build from foundryvtt.com using the
 * account in FOUNDRY_USERNAME / FOUNDRY_PASSWORD.
 *
 *   download/cli.js --version 14.367 --out playwright/cache/FoundryVTT-Node-14.367.zip
 */
import { parseArgs } from "node:util";
import { isMainModule } from "../cli/is-main.js";
import { downloadFoundryBuild } from "./foundryvtt.js";

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { version: { type: "string" }, out: { type: "string" } } });
  const username = process.env.FOUNDRY_USERNAME;
  const password = process.env.FOUNDRY_PASSWORD;
  if (!values.version || !values.out) throw new Error("download: usage: --version VER --out FILE");
  if (!username || !password) throw new Error("download: set FOUNDRY_USERNAME and FOUNDRY_PASSWORD");
  console.log(`Downloading Foundry VTT ${values.version} (Node.js) from foundryvtt.com as ${username}...`);
  await downloadFoundryBuild({ username, password }, values.version, values.out);
  console.log(`Saved ${values.out}`);
}

if (isMainModule(import.meta.url)) {
  main().catch((failure: unknown) => {
    console.error(failure instanceof Error ? failure.message : failure);
    process.exit(1);
  });
}
