/**
 * World fixtures driven through the live Foundry game API: pregenerated
 * characters with Society IDs, parties, player assignments, settings,
 * flags, and cleanup.
 *
 * Every function body passed to page.evaluate() runs in the browser, so it
 * may only use its serialized argument and browser globals.
 */
import type { Page } from "@playwright/test";

export interface SocietyIdentity {
  playerNumber: number;
  characterNumber: number;
  faction?: string;
}

export interface PregenRequest {
  /** Compendium collection id, e.g. "pf2e.iconics". */
  packId: string;
  /** Exact compendium entry name, e.g. "Amiri (Level 3)". */
  entryName: string;
  /** Name for the imported actor. */
  name: string;
  /** Organized Play identity (PF2e/SF2e `system.pfs`). */
  society?: SocietyIdentity;
}

/**
 * Imports a pregenerated character from a compendium, optionally filling in
 * its Organized Play identity (pregens ship without one).
 *
 * @returns The new actor's id
 */
export async function importPregen(page: Page, request: PregenRequest): Promise<string> {
  return page.evaluate(async ({ packId, entryName, name, society }) => {
    const g = globalThis as unknown as PageGlobals;
    const pack = g.game.packs.get(packId);
    if (!pack) throw new Error(`importPregen: compendium ${packId} not found`);
    const entry = (await pack.getIndex()).find((item) => item.name === entryName);
    if (!entry) throw new Error(`importPregen: ${entryName} not found in ${packId}`);
    const data = (await pack.getDocument(entry._id)).toObject();
    data.name = name;
    const created = await g.CONFIG.Actor.documentClass.create(data);
    if (society) {
      await created.update({
        "system.pfs.playerNumber": society.playerNumber,
        "system.pfs.characterNumber": society.characterNumber,
        ...(society.faction ? { "system.pfs.currentFaction": society.faction } : {}),
      });
    }
    return created.id;
  }, request);
}

/** Creates a party actor containing the given member actors. */
export async function createParty(page: Page, name: string, memberIds: string[]): Promise<string> {
  return page.evaluate(
    async ({ partyName, ids }) => {
      const g = globalThis as unknown as PageGlobals;
      const members = ids.map((id) => ({ uuid: g.game.actors.get(id)?.uuid ?? `Actor.${id}` }));
      const party = await g.CONFIG.Actor.documentClass.create({
        name: partyName,
        type: "party",
        system: { details: { members } },
      });
      return party.id;
    },
    { partyName: name, ids: memberIds }
  );
}

/** Deletes every actor whose name starts with one of the prefixes. */
export async function deleteActorsByPrefix(page: Page, prefixes: string[]): Promise<void> {
  await page.evaluate(async (namePrefixes) => {
    const g = globalThis as unknown as PageGlobals;
    const ids = g.game.actors
      .filter((actor) => namePrefixes.some((prefix) => actor.name.startsWith(prefix)))
      .map((actor) => actor.id);
    if (ids.length > 0) await g.CONFIG.Actor.documentClass.deleteDocuments(ids);
  }, prefixes);
}

/** Deletes every chat message. */
export async function deleteChatMessages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const g = globalThis as unknown as PageGlobals;
    const ids = g.game.messages.map((message) => message.id);
    if (ids.length > 0) await g.CONFIG.ChatMessage.documentClass.deleteDocuments(ids);
  });
}

/** Writes a world or client setting. */
export async function setSetting(page: Page, scope: string, key: string, value: unknown): Promise<void> {
  await page.evaluate(
    async ({ settingScope, settingKey, settingValue }) => {
      const g = globalThis as unknown as PageGlobals;
      await g.game.settings.set(settingScope, settingKey, settingValue);
    },
    { settingScope: scope, settingKey: key, settingValue: value }
  );
}

/** Applies a Foundry document update to an actor. */
export async function updateActor(page: Page, actorId: string, data: Record<string, unknown>): Promise<void> {
  await page.evaluate(
    async ({ id, changes }) => {
      const g = globalThis as unknown as PageGlobals;
      await g.game.actors.get(id)?.update(changes);
    },
    { id: actorId, changes: data }
  );
}

/** Reads a flag from an actor (undefined when unset). */
export async function readActorFlag(page: Page, actorId: string, scope: string, key: string): Promise<unknown> {
  return page.evaluate(
    ({ id, flagScope, flagKey }) => {
      const g = globalThis as unknown as PageGlobals;
      return g.game.actors.get(id)?.getFlag(flagScope, flagKey);
    },
    { id: actorId, flagScope: scope, flagKey: key }
  );
}

/** Makes a user the owner of an actor and sets it as their character. */
export async function assignCharacterToUser(page: Page, actorId: string, userName: string): Promise<void> {
  await page.evaluate(
    async ({ id, user }) => {
      const g = globalThis as unknown as PageGlobals;
      const player = g.game.users.getName(user);
      if (!player) throw new Error(`assignCharacterToUser: user ${user} not found`);
      await g.game.actors.get(id)?.update({ ownership: { default: 0, [player.id]: 3 } });
      await player.update({ character: id });
    },
    { id: actorId, user: userName }
  );
}

/** Opens an actor's sheet. */
export async function renderActorSheet(page: Page, actorId: string): Promise<void> {
  await page.evaluate(async (id) => {
    const g = globalThis as unknown as PageGlobals;
    const actor = g.game.actors.get(id);
    if (!actor) throw new Error(`renderActorSheet: actor ${id} not found`);
    await actor.sheet.render(true);
  }, actorId);
}

/** Closes every open application window. */
export async function closeAllSheets(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const g = globalThis as unknown as PageGlobals;
    await Promise.all([...g.foundry.applications.instances.values()].map((app) => app.close()));
  });
}

/** The active game system id, e.g. "pf2e" or "sf2e". */
export async function gameSystemId(page: Page): Promise<string> {
  return page.evaluate(() => (globalThis as unknown as PageGlobals).game.system.id);
}

/** Minimal shape of the Foundry globals these helpers touch. */
interface PageGlobals {
  game: {
    system: { id: string };
    packs: Map<string, CompendiumPack>;
    actors: FoundryCollection<GameActor>;
    users: FoundryCollection<GameUser> & { getName(name: string): GameUser | undefined };
    messages: { map<T>(transform: (message: { id: string }) => T): T[] };
    settings: { set(scope: string, key: string, value: unknown): Promise<unknown> };
  };
  /**
   * Document classes via CONFIG, not the Actor/ChatMessage globals: Foundry
   * 12 declares those in classic scripts, so they are not on globalThis.
   */
  CONFIG: {
    Actor: {
      documentClass: {
        create(data: Record<string, unknown>): Promise<GameActor>;
        deleteDocuments(ids: string[]): Promise<unknown>;
      };
    };
    ChatMessage: { documentClass: { deleteDocuments(ids: string[]): Promise<unknown> } };
  };
  foundry: { applications: { instances: Map<string, { close(): Promise<unknown> }> } };
}

interface FoundryCollection<T> {
  get(id: string): T | undefined;
  filter(predicate: (item: T) => boolean): T[];
}

interface CompendiumPack {
  getIndex(): Promise<{
    find(predicate: (item: { _id: string; name: string }) => boolean): { _id: string } | undefined;
  }>;
  getDocument(id: string): Promise<{ toObject(): Record<string, unknown> }>;
}

interface GameActor {
  id: string;
  uuid: string;
  name: string;
  sheet: { render(force: boolean): Promise<unknown> };
  update(data: Record<string, unknown>): Promise<unknown>;
  getFlag(scope: string, key: string): unknown;
}

interface GameUser {
  id: string;
  update(data: Record<string, unknown>): Promise<unknown>;
}
