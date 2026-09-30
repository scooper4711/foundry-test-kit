import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { moduleBundleMarker, startCoverage, stopCoverage } from "../src/coverage.js";
import { tempProject, withEnv } from "./support.js";

function fakePage(entries: { url: string; functions: unknown[] }[] | undefined) {
  const started: unknown[] = [];
  const page = entries
    ? {
        coverage: {
          startJSCoverage: async (options: unknown) => void started.push(options),
          stopJSCoverage: async () => entries,
        },
      }
    : {};
  return { page: page as never, started };
}

describe("coverage chunks", () => {
  const root = tempProject({ moduleId: "my-module", coverage: { bundle: "build/module.js" } });

  it("identifies the module bundle from the config", async () => {
    await withEnv({ FOUNDRY_TEST_ROOT: root }, () => expect(moduleBundleMarker()).toBe("my-module/build/module.js"));
  });

  it("starts coverage without resetting on navigation", async () => {
    const { page, started } = fakePage([]);
    await startCoverage(page);
    expect(started).toEqual([{ resetOnNavigation: false }]);
  });

  it("writes only the module bundle's ranges", async () => {
    const { page } = fakePage([
      { url: "http://localhost/modules/my-module/build/module.js", functions: [{ functionName: "init" }] },
      { url: "http://localhost/scripts/foundry.mjs", functions: [{ functionName: "core" }] },
    ]);
    await withEnv({ FOUNDRY_TEST_ROOT: root }, () => stopCoverage(page, "pf2e-spec"));
    const chunk = JSON.parse(readFileSync(join(root, "coverage/e2e-raw/pf2e-spec.json"), "utf8"));
    expect(chunk).toEqual([
      { url: "http://localhost/modules/my-module/build/module.js", functions: [{ functionName: "init" }] },
    ]);
  });

  it("writes nothing for pages without the bundle or without coverage support", async () => {
    await withEnv({ FOUNDRY_TEST_ROOT: root }, async () => {
      await stopCoverage(fakePage([{ url: "http://localhost/other.js", functions: [] }]).page, "no-bundle");
      await stopCoverage(fakePage(undefined).page, "no-coverage");
    });
    expect(existsSync(join(root, "coverage/e2e-raw/no-bundle.json"))).toBe(false);
    expect(existsSync(join(root, "coverage/e2e-raw/no-coverage.json"))).toBe(false);
  });
});
