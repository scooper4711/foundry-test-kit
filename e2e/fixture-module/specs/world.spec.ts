/**
 * End-to-end check of the kit against whatever Foundry version it seeded:
 * the world, the module, the fixtures, and the generic world helpers.
 */
import {
  deleteActorsByPrefix,
  disableSceneCanvas,
  joinAsPlayer,
  readActorFlag,
  setSetting,
  suiteContextOptions,
  test,
  expect,
} from "@scooper4711/foundry-test-kit";

const MODULE_ID = "foundry-test-kit-fixture";

interface FixtureGlobals {
  game: {
    version: string;
    system: { id: string };
    modules: Map<string, { active: boolean }>;
    user: { isGM: boolean; name: string };
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
    };
  }, MODULE_ID);
  console.log(`Foundry ${world.version}, system ${world.system}`);
  expect(world).toMatchObject({ system: "worldbuilding", active: true, loaded: true, isGM: true });
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

test("the seeded test player can join", async ({ browser }) => {
  const context = await browser.newContext(suiteContextOptions());
  await disableSceneCanvas(context);
  try {
    const page = await context.newPage();
    await joinAsPlayer(page, "TestPlayer");
    // Read fields explicitly: isGM is a getter, which does not serialize.
    const user = await page.evaluate(() => {
      const { name, isGM } = (globalThis as unknown as FixtureGlobals).game.user;
      return { name, isGM };
    });
    expect(user).toMatchObject({ name: "TestPlayer", isGM: false });
  } finally {
    await context.close();
  }
});
