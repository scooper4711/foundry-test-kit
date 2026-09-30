/**
 * End-to-end check of the kit against whatever Foundry version it seeded:
 * the world, the module, the fixtures, and the generic world helpers.
 */
import {
  deleteActorsByPrefix,
  disableSceneCanvas,
  joinAsPlayer,
  joinAsUser,
  loadTestKitConfig,
  readActorFlag,
  setSetting,
  suiteContextOptions,
  test,
  testUser,
  expect,
  USER_ROLE_LEVELS,
} from "@scooper4711/foundry-test-kit";
import type { Browser, Page } from "@playwright/test";

const MODULE_ID = "foundry-test-kit-fixture";

interface FixtureGlobals {
  game: {
    version: string;
    system: { id: string };
    modules: Map<string, { active: boolean }>;
    user: { isGM: boolean; name: string; role: number };
  };
  foundryTestKitFixtureReady?: boolean;
}

test("the seeded world runs the module", async ({ gmPage }) => {
  const world = await gmPage.evaluate((moduleId) => {
    const g = globalThis as unknown as FixtureGlobals;
    return {
      version: g.game.version,
      system: g.game.system.id,
      active: g.game.modules.get(moduleId)?.active ?? false,
      loaded: g.foundryTestKitFixtureReady === true,
      isGM: g.game.user.isGM,
      userName: g.game.user.name,
    };
  }, MODULE_ID);
  console.log(`Foundry ${world.version}, system ${world.system}`);
  // The fixtures join as the configured (renamed, password-protected) Gamemaster.
  expect(world).toMatchObject({ system: "worldbuilding", active: true, loaded: true, isGM: true, userName: "Kit GM" });
  if (process.env.EXPECTED_FOUNDRY_MAJOR) expect(world.version.split(".")[0]).toBe(process.env.EXPECTED_FOUNDRY_MAJOR);
});

test("world helpers create, flag, and clean up actors", async ({ gmPage }) => {
  const actorId = await gmPage.evaluate(async (moduleId) => {
    type Created = { id: string; setFlag(...args: unknown[]): Promise<unknown> };
    const g = globalThis as unknown as {
      CONFIG: { Actor: { documentClass: { create(data: object): Promise<Created> } } };
    };
    const actor = await g.CONFIG.Actor.documentClass.create({ name: "KIT Actor", type: "character" });
    await actor.setFlag(moduleId, "probe", "set");
    return actor.id;
  }, MODULE_ID);
  expect(await readActorFlag(gmPage, actorId, MODULE_ID, "probe")).toBe("set");

  await deleteActorsByPrefix(gmPage, ["KIT "]);
  const remaining = await gmPage.evaluate(
    (id) => (globalThis as unknown as { game: { actors: { get(id: string): unknown } } }).game.actors.get(id) ?? null,
    actorId
  );
  expect(remaining).toBeNull();
  await setSetting(gmPage, "core", "time", 0);
});

test("the first seeded player joins by default", async ({ browser }) => {
  const user = await asNewUser(browser, (page) => joinAsPlayer(page));
  expect(user).toEqual({ name: testUser().name, role: USER_ROLE_LEVELS.player, isGM: false });
});

test("every seeded user joins at its role, with its password", async ({ browser }) => {
  for (const seeded of loadTestKitConfig().seed.users) {
    const user = await asNewUser(browser, (page) => joinAsUser(page, seeded.name));
    // Foundry counts Assistant GMs and up as GMs.
    const role = USER_ROLE_LEVELS[seeded.role];
    expect(user).toEqual({ name: seeded.name, role, isGM: role >= USER_ROLE_LEVELS.assistant });
  }
});

/** Joins in a fresh context and reports who the page is logged in as. */
async function asNewUser(browser: Browser, join: (page: Page) => Promise<void>) {
  const context = await browser.newContext(suiteContextOptions());
  await disableSceneCanvas(context);
  try {
    const page = await context.newPage();
    await join(page);
    // Read fields explicitly: isGM is a getter, which does not serialize.
    return await page.evaluate(() => {
      const { name, role, isGM } = (globalThis as unknown as FixtureGlobals).game.user;
      return { name, role, isGM };
    });
  } finally {
    await context.close();
  }
}
