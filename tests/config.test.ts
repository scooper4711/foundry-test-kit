import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_FILE_NAME, loadTestKitConfig, normalizeConfig } from "../src/config.js";

describe("normalizeConfig", () => {
  it("fills defaults around the required module id", () => {
    const config = normalizeConfig({ moduleId: "my-module" }, "/project");
    expect(config).toEqual({
      moduleId: "my-module",
      foundryVersion: "14.367",
      testWorlds: [{ id: "integration-test", system: "pf2e", title: "Integration Test" }],
      devWorld: { id: "dev-test", system: "pf2e", title: "Dev Test" },
      systems: ["pf2e"],
      seed: { settings: [] },
      coverage: { bundle: "dist/main.js" },
      workDir: "/project/.foundry-test",
      projectRoot: "/project",
    });
  });

  it("derives installed systems from every world", () => {
    const config = normalizeConfig(
      { moduleId: "m", testWorlds: [{ id: "pf" }, { id: "sf", system: "sf2e", title: "SFS" }] },
      "/p"
    );
    expect(config.systems).toEqual(["pf2e", "sf2e"]);
    expect(config.testWorlds[1]).toEqual({ id: "sf", system: "sf2e", title: "SFS" });
    expect(config.testWorlds[0].title).toBe("pf");
  });

  it("resolves a custom work directory against the project root", () => {
    expect(normalizeConfig({ moduleId: "m", workDir: "build/foundry" }, "/p").workDir).toBe("/p/build/foundry");
  });

  it("keeps explicitly listed systems", () => {
    expect(normalizeConfig({ moduleId: "m", systems: ["pf2e", "sf2e"] }, "/p").systems).toEqual(["pf2e", "sf2e"]);
  });

  it("requires a module id and world ids", () => {
    expect(() => normalizeConfig({}, "/p")).toThrow(/moduleId/);
    expect(() => normalizeConfig({ moduleId: "m", testWorlds: [{ system: "pf2e" }] }, "/p")).toThrow(/"id"/);
  });
});

describe("loadTestKitConfig", () => {
  const savedRoot = process.env.FOUNDRY_TEST_ROOT;
  afterEach(() => {
    if (savedRoot === undefined) delete process.env.FOUNDRY_TEST_ROOT;
    else process.env.FOUNDRY_TEST_ROOT = savedRoot;
  });

  function projectWith(contents: string): string {
    const root = mkdtempSync(join(tmpdir(), "kit-config-"));
    writeFileSync(join(root, CONFIG_FILE_NAME), contents);
    return root;
  }

  it("finds the config in a parent directory", () => {
    delete process.env.FOUNDRY_TEST_ROOT;
    const root = projectWith(JSON.stringify({ moduleId: "found-me" }));
    const nested = join(root, "tests", "integration");
    mkdirSync(nested, { recursive: true });
    const config = loadTestKitConfig(nested);
    expect(config.moduleId).toBe("found-me");
    expect(config.projectRoot).toBe(root);
  });

  it("prefers FOUNDRY_TEST_ROOT", () => {
    process.env.FOUNDRY_TEST_ROOT = projectWith(JSON.stringify({ moduleId: "from-env" }));
    expect(loadTestKitConfig("/").moduleId).toBe("from-env");
  });

  it("explains a missing or broken config", () => {
    delete process.env.FOUNDRY_TEST_ROOT;
    expect(() => loadTestKitConfig(mkdtempSync(join(tmpdir(), "kit-none-")))).toThrow(/no foundry-test.config.json/);
    expect(() => loadTestKitConfig(projectWith("{ not json"))).toThrow(/not valid JSON/);
  });
});
