import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CONFIG_FILE_NAME } from "../src/config.js";

/** Creates a throwaway project directory holding a foundry-test config. */
export function tempProject(config: Record<string, unknown>, files: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), "kit-project-"));
  writeFileSync(join(root, CONFIG_FILE_NAME), JSON.stringify(config));
  for (const [name, contents] of Object.entries(files)) writeFileSync(join(root, name), contents);
  return root;
}

/** Runs `action` with env variables temporarily set (undefined deletes). */
export async function withEnv<T>(changes: Record<string, string | undefined>, action: () => T | Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(changes).map((name) => [name, process.env[name]]));
  const apply = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  apply(changes);
  try {
    return await action();
  } finally {
    apply(saved);
  }
}
