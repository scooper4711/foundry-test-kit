import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../src/config.js";
import { renderDotEnvExports, renderShellEnv, runShellConfig, shellQuote, worldField } from "../src/cli/shell-config.js";
import { tempProject } from "./support.js";

const config = normalizeConfig(
  {
    moduleId: "my-module",
    testWorlds: [
      { id: "integration-test", system: "pf2e", title: "Integration Test" },
      { id: "sfs-test", system: "sf2e", title: "SFS Test" },
    ],
    devWorld: { id: "dev-world", title: "Dev's World" },
  },
  "/projects/my module"
);

/** Evaluates shell text in bash and echoes a variable, to prove quoting. */
function bashValue(script: string, variable: string): string {
  return execFileSync("bash", ["-c", `${script}\nprintf %s "$${variable}"`], { encoding: "utf8" });
}

describe("shellQuote", () => {
  it("survives quotes and spaces in bash", () => {
    const value = "it's $HOME and `ls`";
    expect(bashValue(`V=${shellQuote(value)}`, "V")).toBe(value);
  });
});

describe("renderShellEnv", () => {
  it("renders the settings the CLI reads", () => {
    const env = renderShellEnv(config);
    expect(bashValue(env, "KIT_MODULE_ID")).toBe("my-module");
    expect(bashValue(env, "KIT_TEST_WORLDS")).toBe("integration-test:pf2e sfs-test:sf2e");
    expect(bashValue(env, "KIT_SYSTEMS")).toBe("pf2e,sf2e");
    expect(bashValue(env, "KIT_PROJECT_ROOT")).toBe("/projects/my module");
    expect(bashValue(env, "KIT_BUNDLE")).toBe("dist/main.js");
  });
});

describe("renderDotEnvExports", () => {
  it("exports .env values that are not already set", () => {
    const exports = renderDotEnvExports("A=one\nB='two words'\n# comment\nC=three", { C: "already" });
    expect(bashValue(exports, "A")).toBe("one");
    expect(bashValue(exports, "B")).toBe("two words");
    expect(exports).not.toContain("C=");
  });

  it("leaves decrypted values alone when .env holds encrypted ones", () => {
    const exports = renderDotEnvExports('FOUNDRY_PASSWORD="encrypted:BExyz"', { FOUNDRY_PASSWORD: "decrypted" });
    expect(exports).toBe("");
  });

  it("skips names a shell cannot export", () => {
    expect(renderDotEnvExports("BAD-NAME=x\nGOOD=y", {})).toBe("export GOOD='y'");
  });
});

describe("worldField", () => {
  it("reads configured worlds, then falls back", () => {
    expect(worldField(config, "sfs-test", "system")).toBe("sf2e");
    expect(worldField(config, "dev-world", "title")).toBe("Dev's World");
    expect(worldField(config, "ad-hoc", "title")).toBe("ad-hoc");
    expect(worldField(config, "ad-hoc", "system")).toBe("pf2e");
  });
});

describe("runShellConfig", () => {
  it("dispatches env, world, and dotenv commands", () => {
    expect(runShellConfig(["env"], config, {})).toContain("KIT_MODULE_ID='my-module'");
    expect(runShellConfig(["world", "sfs-test", "title"], config, {})).toBe("SFS Test");
  });

  it("exports the project's .env, or nothing without one", () => {
    const root = tempProject({ moduleId: "m" }, { ".env": "FOUNDRY_LICENSE_KEY=abc" });
    const withDotEnv = normalizeConfig({ moduleId: "m" }, root);
    expect(runShellConfig(["dotenv"], withDotEnv, {})).toBe("export FOUNDRY_LICENSE_KEY='abc'");
    expect(runShellConfig(["dotenv"], normalizeConfig({ moduleId: "m" }, tempProject({ moduleId: "m" })), {})).toBe("");
  });

  it("rejects unknown commands", () => {
    expect(() => runShellConfig(["world", "x", "color"], config, {})).toThrow(/usage/);
  });
});
