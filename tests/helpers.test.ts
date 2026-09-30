import { describe, expect, it } from "vitest";
import { coverageChunkName } from "../src/coverage.js";
import { missingSettingVariables, resolveSettings } from "../src/seed/settings.js";
import { log, systemDisplayName } from "../src/seed/options.js";
import { vi } from "vitest";

describe("coverageChunkName", () => {
  it("prefixes the project and slugs the title", () => {
    expect(coverageChunkName("pf2e", "/repo/tests/a/party.spec.ts", "Generates chronicles (all 3)!")).toBe(
      "pf2e-party.spec.ts-generates-chronicles-all-3-"
    );
  });
});

describe("resolveSettings", () => {
  it("uses literal values and env values, skipping unset env", () => {
    const settings = [
      { key: "debug", value: true },
      { key: "token", fromEnv: "TOKEN" },
      { key: "missing", fromEnv: "NOT_SET" },
    ];
    expect(resolveSettings(settings, { TOKEN: "secret" })).toEqual([
      { key: "debug", value: true },
      { key: "token", value: "secret" },
    ]);
    expect(missingSettingVariables(settings, { TOKEN: "secret" })).toEqual(["NOT_SET"]);
  });
});

describe("systemDisplayName", () => {
  it("names known systems and passes others through", () => {
    expect(systemDisplayName("sf2e")).toBe("Starfinder Second Edition");
    expect(systemDisplayName("custom")).toBe("custom");
  });
});

describe("log", () => {
  it("prints seeding progress", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log("-> step");
    expect(spy).toHaveBeenCalledWith("-> step");
    spy.mockRestore();
  });
});
