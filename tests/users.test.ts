import { describe, expect, it } from "vitest";
import { testUser } from "../src/config.js";
import {
  DEFAULT_GAMEMASTER_NAME,
  DEFAULT_PLAYER_NAME,
  findSeedUser,
  normalizeSeedUsers,
  seedUserPassword,
} from "../src/users.js";
import { tempProject, withEnv } from "./support.js";

describe("normalizeSeedUsers", () => {
  it("defaults to Foundry's Gamemaster and one passwordless player", () => {
    expect(normalizeSeedUsers()).toEqual({
      gamemaster: { name: DEFAULT_GAMEMASTER_NAME, password: "" },
      users: [{ name: DEFAULT_PLAYER_NAME, role: "player", password: "" }],
    });
  });

  it("keeps a renamed Gamemaster and users at every role", () => {
    const users = normalizeSeedUsers({
      gamemaster: { name: "Game Master", password: "gm-key" },
      users: [
        { name: "Pat", role: "player" },
        { name: "Tess", role: "trusted", password: "t" },
        { name: "Ada", role: "assistant" },
        { name: "Co-GM", role: "gamemaster" },
      ],
    });
    expect(users.gamemaster).toEqual({ name: "Game Master", password: "gm-key" });
    expect(users.users.map((user) => `${user.name}:${user.role}:${user.password}`)).toEqual([
      "Pat:player:",
      "Tess:trusted:t",
      "Ada:assistant:",
      "Co-GM:gamemaster:",
    ]);
  });

  it("seeds no extra users for an explicit empty list", () => {
    expect(normalizeSeedUsers({ users: [] }).users).toEqual([]);
  });

  it("rejects nameless users, unknown roles, and duplicate names", () => {
    expect(() => normalizeSeedUsers({ users: [{ role: "player" }] })).toThrow(/needs a "name"/);
    expect(() => normalizeSeedUsers({ users: [{ name: "X", role: "owner" as never }] })).toThrow(/role "owner"/);
    expect(() => normalizeSeedUsers({ users: [{ name: "Gamemaster" }] })).toThrow(/"Gamemaster" is configured twice/);
  });
});

describe("findSeedUser", () => {
  const config = normalizeSeedUsers({ users: [{ name: "Tess", role: "trusted" }, { name: "Pat" }] });

  it("returns the first user with the role, a player by default", () => {
    expect(findSeedUser(config).name).toBe("Pat");
    expect(findSeedUser(config, "trusted").name).toBe("Tess");
  });

  it("names the missing role", () => {
    expect(() => findSeedUser(config, "assistant")).toThrow(/role "assistant"/);
  });
});

describe("seedUserPassword", () => {
  const config = normalizeSeedUsers({ gamemaster: { password: "gm" }, users: [{ name: "Tess", password: "t" }] });

  it("finds the Gamemaster's and users' keys, and none for strangers", () => {
    expect(seedUserPassword(config, "Gamemaster")).toBe("gm");
    expect(seedUserPassword(config, "Tess")).toBe("t");
    expect(seedUserPassword(config, "Nobody")).toBe("");
  });
});

describe("testUser", () => {
  it("reads users from the project config", async () => {
    const root = tempProject({ moduleId: "m", seed: { users: [{ name: "Ada", role: "assistant" }] } });
    const user = await withEnv({ FOUNDRY_TEST_ROOT: root }, () => testUser("assistant"));
    expect(user).toEqual({ name: "Ada", role: "assistant", password: "" });
  });
});
