import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planInit, runInit, supportedMajors, SYSTEM_AGNOSTIC_WORLD_SYSTEM } from "../src/cli/init.js";

/** A throwaway module directory holding the given files. */
function moduleProject(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "kit-init-"));
  for (const [name, contents] of Object.entries(files)) {
    writeFileSync(join(root, name), typeof contents === "string" ? contents : JSON.stringify(contents, null, 4));
  }
  return root;
}

const PF2E_MODULE = {
  id: "my-module",
  esmodules: ["./dist/main.js"],
  compatibility: { minimum: "12", verified: "14" },
  relationships: { systems: [{ id: "pf2e" }, { id: "sf2e" }] },
};

describe("planInit", () => {
  it("derives worlds, the bundle, and per-major scripts from module.json", () => {
    const plan = planInit(PF2E_MODULE);
    expect(plan.config).toEqual({
      moduleId: "my-module",
      foundryVersion: "latest",
      testWorlds: [
        { id: "pf2e-test", system: "pf2e" },
        { id: "sf2e-test", system: "sf2e" },
      ],
      devWorld: { id: "my-module-dev", system: "pf2e" },
      coverage: { bundle: "dist/main.js" },
    });
    expect(plan.scripts).toEqual({
      integration: "foundry-test test run --all-worlds",
      "integration:v12": "foundry-test test run --all-worlds --version latest-12",
      "integration:v13": "foundry-test test run --all-worlds --version latest-13",
      "coverage:e2e": "foundry-test-coverage",
    });
  });

  it("uses Simple Worldbuilding for a system-agnostic module", () => {
    const plan = planInit({ id: "generic" });
    expect(plan.config.testWorlds).toEqual([{ id: "worldbuilding-test", system: SYSTEM_AGNOSTIC_WORLD_SYSTEM }]);
    expect(plan.config).not.toHaveProperty("coverage");
  });

  it("needs a module id", () => {
    expect(() => planInit({})).toThrow(/no "id"/);
  });
});

describe("supportedMajors", () => {
  it("spans minimum to the newest declared major, from 12 up", () => {
    expect(supportedMajors({ compatibility: { minimum: 10, maximum: "13.351" } })).toEqual([12, 13]);
    expect(supportedMajors({ compatibility: { verified: "14" } })).toEqual([14]);
    expect(supportedMajors({})).toEqual([]);
  });
});

describe("runInit", () => {
  it("writes the scaffold, adds scripts and ignores, and keeps the indentation", () => {
    const root = moduleProject({
      "module.json": PF2E_MODULE,
      "package.json": { name: "my-module", scripts: { build: "tsc" } },
      ".gitignore": "node_modules/",
    });
    const report = runInit(root);

    expect(report.filter((line) => line.startsWith("created")).length).toBe(3);
    const config = JSON.parse(readFileSync(join(root, "foundry-test.config.json"), "utf8"));
    expect(config.moduleId).toBe("my-module");
    expect(readFileSync(join(root, "playwright.config.mts"), "utf8")).toContain("defineFoundryConfig()");
    expect(readFileSync(join(root, "tests/integration/smoke.spec.ts"), "utf8")).toContain('"my-module"');
    const packageText = readFileSync(join(root, "package.json"), "utf8");
    expect(packageText).toContain('    "scripts"');
    expect(JSON.parse(packageText).scripts).toMatchObject({ build: "tsc", integration: expect.any(String) });
    expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe("node_modules/\n.foundry-test/\ntest-results/\n.env\n");
  });

  it("keeps everything that already exists", () => {
    const root = moduleProject({
      "module.json": PF2E_MODULE,
      "foundry-test.config.json": "{}",
      "playwright.config.ts": "// mine",
      "package.json": { scripts: { integration: "mine" } },
      ".gitignore": "/.foundry-test/\ntest-results/\n.env\n",
    });
    const report = runInit(root);

    expect(report).toContain("kept     foundry-test.config.json (already exists)");
    expect(report.some((line) => line.startsWith("kept     playwright.config.ts"))).toBe(true);
    expect(report).toContain('kept     script "integration" (already defined)');
    expect(report).toContain("kept     .gitignore (already ignores the kit's files)");
    expect(readFileSync(join(root, "foundry-test.config.json"), "utf8")).toBe("{}");
  });

  it("skips scripts without a package.json and refuses without a module.json", () => {
    expect(runInit(moduleProject({ "module.json": { id: "m" } }))).toContain(
      "skipped  package.json scripts (no package.json)"
    );
    expect(() => runInit(moduleProject({}))).toThrow(/no module.json/);
  });
});
