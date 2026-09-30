import { describe, expect, it } from "vitest";
import { disableSceneCanvas, suiteContextOptions, testBaseUrl } from "../src/context.js";
import { defineFoundryConfig } from "../src/playwright-config.js";
import { tempProject, withEnv } from "./support.js";

describe("test server URL and context options", () => {
  it("follows FOUNDRY_TEST_PORT, defaulting to 30001", async () => {
    await withEnv({ FOUNDRY_TEST_PORT: undefined }, () => expect(testBaseUrl()).toBe("http://localhost:30001"));
    await withEnv({ FOUNDRY_TEST_PORT: "40001" }, () =>
      expect(suiteContextOptions("state.json")).toEqual({
        baseURL: "http://localhost:40001",
        viewport: { width: 1600, height: 900 },
        storageState: "state.json",
      })
    );
  });
});

describe("disableSceneCanvas", () => {
  it("installs an init script that sets core.noCanvas", async () => {
    let script: (() => void) | undefined;
    const target = { addInitScript: async (fn: () => void) => void (script = fn) };
    await disableSceneCanvas(target as never);

    const stored = new Map<string, string>();
    const globals = globalThis as unknown as { window?: unknown };
    globals.window = { localStorage: { setItem: (key: string, value: string) => stored.set(key, value) } };
    try {
      script?.();
    } finally {
      delete globals.window;
    }
    expect(stored.get("core.noCanvas")).toBe("true");
  });
});

describe("defineFoundryConfig", () => {
  it("creates one project per test world system and points at the project", async () => {
    const root = tempProject({
      moduleId: "my-module",
      testWorlds: [
        { id: "a", system: "pf2e" },
        { id: "b", system: "sf2e" },
        { id: "c", system: "pf2e" },
      ],
    });
    const config = await withEnv({ FOUNDRY_TEST_ROOT: root, FOUNDRY_TEST_PORT: "40001" }, () => defineFoundryConfig());
    expect(config.projects?.map((project) => project.name)).toEqual(["pf2e", "sf2e"]);
    expect(config.testDir).toBe(`${root}/tests/integration`);
    expect(config.workers).toBe(1);
    expect(config.use?.baseURL).toBe("http://localhost:40001");
  });

  it("accepts custom projects and overrides", async () => {
    const root = tempProject({ moduleId: "m" });
    const config = await withEnv({ FOUNDRY_TEST_ROOT: root }, () =>
      defineFoundryConfig({ testDir: "e2e", projects: [{ name: "pf2e", testIgnore: /sf/ }], overrides: { retries: 2 } })
    );
    expect(config.testDir).toBe(`${root}/e2e`);
    expect(config.projects).toEqual([{ name: "pf2e", testIgnore: /sf/ }]);
    expect(config.retries).toBe(2);
  });
});
