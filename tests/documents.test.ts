import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actorConditionSource,
  actorOn,
  createDocuments,
  deleteDocuments,
  evaluateActorSource,
  findActorInPage,
  updateDocuments,
  waitForSetting,
  type ActorRef,
} from "../src/documents.js";

/** A page-like context with two actors, to run the generated page source in. */
function fakeWorld() {
  const actors = [
    { id: "a1", name: "Kyra", flags: { "demiplane-pf2e": { characterId: "c-1", tokens: [] } } },
    { id: "a2", name: "Ezren", flags: { "demiplane-pf2e": { characterId: "c-2", tokens: ["x"] } } },
  ].map((actor) => ({
    ...actor,
    getFlag: (scope: string, key: string) => (actor.flags as Record<string, Record<string, unknown>>)[scope]?.[key],
  }));
  const game = { actors: { get: (id: string) => actors.find((actor) => actor.id === id), contents: actors } };
  return { game };
}

const runPage = (source: string) => runInNewContext(source, { globalThis: fakeWorld(), ...fakeWorld() });

describe("evaluateActorSource", () => {
  const byFlag: ActorRef = { flag: { scope: "demiplane-pf2e", key: "characterId", value: "c-2" } };

  it("finds actors by id, name, or flag and returns the function's result", async () => {
    const name = "(actor) => actor.name";
    expect(await runPage(evaluateActorSource({ id: "a1" }, name, undefined))).toBe("Kyra");
    expect(await runPage(evaluateActorSource({ name: "Ezren" }, name, undefined))).toBe("Ezren");
    expect(await runPage(evaluateActorSource(byFlag, name, undefined))).toBe("Ezren");
  });

  it("passes the argument through", async () => {
    const source = evaluateActorSource({ id: "a1" }, "(actor, arg) => `${actor.name}:${arg.suffix}`", { suffix: "!" });
    expect(await runPage(source)).toBe("Kyra:!");
  });

  it("rejects with the reference when no actor matches", async () => {
    await expect(runPage(evaluateActorSource({ name: "Nobody" }, "(actor) => actor", undefined))).rejects.toThrow(
      /no actor matches \{"name":"Nobody"\}/
    );
  });
});

describe("actorConditionSource", () => {
  const empty = "(actor) => actor.getFlag('demiplane-pf2e', 'tokens').length === 0";

  it("evaluates the condition against the actor", () => {
    expect(runPage(actorConditionSource({ id: "a1" }, empty, undefined))).toBe(true);
    expect(runPage(actorConditionSource({ id: "a2" }, empty, undefined))).toBe(false);
  });

  it("is false while the actor is missing", () => {
    expect(runPage(actorConditionSource({ id: "missing" }, empty, undefined))).toBe(false);
  });
});

/** A Page stand-in that records what each helper sends and answers with `result`. */
function recordingPage(result: unknown = null) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push({ method, args });
      return result;
    };
  return { calls, page: { evaluate: record("evaluate"), waitForFunction: record("waitForFunction") } as never };
}

describe("actorOn", () => {
  it("evaluates, waits, and reads ids through generated page source", async () => {
    const { calls, page } = recordingPage("a1");
    const kyra = actorOn(page, { name: "Kyra" });
    expect(await kyra.id()).toBe("a1");
    await kyra.evaluate((actor) => actor.name);
    await kyra.waitFor((actor) => actor.name === "Kyra", undefined, { timeout: 5 });
    expect(calls.map((call) => call.method)).toEqual(["evaluate", "evaluate", "waitForFunction"]);
    expect(String(calls[0]!.args[0])).toContain("actor.id");
    expect(calls[2]!.args[2]).toEqual({ timeout: 5 });
  });
});

/**
 * A Page stand-in that runs each callback in Node, against Foundry globals
 * stubbed onto globalThis, the way Playwright would run it in the browser.
 */
function executingPage() {
  const run = async (callback: unknown, arg: unknown) =>
    typeof callback === "function" ? (callback as (arg: unknown) => unknown)(arg) : undefined;
  return { evaluate: run, waitForFunction: run } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("waitForSetting", () => {
  it("compares the setting as JSON with a default timeout", async () => {
    const { calls, page } = recordingPage();
    await waitForSetting(page, { scope: "core", key: "time", value: { a: 1 } });
    expect(calls[0]!.args[1]).toEqual({ scope: "core", key: "time", expected: '{"a":1}' });
    expect(calls[0]!.args[2]).toEqual({ timeout: 30_000 });
  });

  it("checks the setting in the page", async () => {
    const settings = new Map<string, unknown>([["core.time", { a: 1 }]]);
    vi.stubGlobal("game", { settings: { get: (scope: string, key: string) => settings.get(`${scope}.${key}`) } });
    const predicate = vi.fn();
    const page = {
      waitForFunction: async (callback: (arg: unknown) => boolean, arg: unknown) => predicate(callback(arg)),
    } as never;
    await waitForSetting(page, { scope: "core", key: "time", value: { a: 1 } });
    await waitForSetting(page, { scope: "core", key: "time", value: { a: 2 } });
    expect(predicate.mock.calls).toEqual([[true], [false]]);
  });
});

describe("document operations", () => {
  it("sends each operation with its document type and payload", async () => {
    const { calls, page } = recordingPage(["n1"]);
    expect(await createDocuments(page, "Item", [{ name: "Rope" }])).toEqual(["n1"]);
    await updateDocuments(page, "Item", [{ _id: "n1", name: "Silk rope" }]);
    await deleteDocuments(page, "Item", ["n1"]);
    expect(calls.map((call) => call.args[1])).toEqual([
      { operation: "create", documentName: "Item", payload: [{ name: "Rope" }] },
      { operation: "update", documentName: "Item", payload: [{ _id: "n1", name: "Silk rope" }] },
      { operation: "delete", documentName: "Item", payload: ["n1"] },
    ]);
  });

  it("goes through the document class in CONFIG", async () => {
    const itemClass = {
      createDocuments: vi.fn(async (data: unknown[]) => data.map((_, index) => ({ id: `i${index}` }))),
      updateDocuments: vi.fn(async () => []),
      deleteDocuments: vi.fn(async () => []),
    };
    vi.stubGlobal("CONFIG", { Item: { documentClass: itemClass } });
    const page = executingPage();
    expect(await createDocuments(page, "Item", [{ name: "Rope" }, { name: "Torch" }])).toEqual(["i0", "i1"]);
    await updateDocuments(page, "Item", [{ _id: "i0", name: "Silk rope" }]);
    await deleteDocuments(page, "Item", ["i1"]);
    expect(itemClass.updateDocuments).toHaveBeenCalledWith([{ _id: "i0", name: "Silk rope" }]);
    expect(itemClass.deleteDocuments).toHaveBeenCalledWith(["i1"]);
  });

  it("names an unknown document type", async () => {
    vi.stubGlobal("CONFIG", {});
    await expect(deleteDocuments(executingPage(), "Widget", ["x"])).rejects.toThrow(
      /deleteDocuments: Foundry has no document type "Widget"/
    );
  });
});

describe("findActorInPage", () => {
  it("finds actors by id, name, and flag, or returns null", () => {
    vi.stubGlobal("game", fakeWorld().game);
    expect(findActorInPage({ id: "a2" })?.name).toBe("Ezren");
    expect(findActorInPage({ name: "Kyra" })?.id).toBe("a1");
    expect(findActorInPage({ flag: { scope: "demiplane-pf2e", key: "characterId", value: "c-1" } })?.id).toBe("a1");
    expect(findActorInPage({ id: "missing" })).toBeNull();
    expect(findActorInPage({ name: "Nobody" })).toBeNull();
    expect(findActorInPage({ flag: { scope: "x", key: "y", value: 1 } })).toBeNull();
  });
});
