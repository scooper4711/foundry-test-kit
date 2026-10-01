/**
 * Typed helpers for reading and changing Foundry documents from a spec:
 * run code next to an actor found by id, name, or a module flag; wait for
 * an actor or a setting to reach a state; and create, update, or delete
 * documents of any type.
 *
 * Functions passed to `evaluate` and `waitFor` run in the browser, like
 * `page.evaluate` callbacks: they may use their arguments and Foundry's
 * page globals, but no variables from the spec around them.
 */
import type { Page } from "@playwright/test";

/** How a spec names an actor: by id, by name, or by a module flag's value. */
export type ActorRef = { id: string } | { name: string } | { flag: { scope: string; key: string; value: unknown } };

/** The parts of a Foundry document specs touch. */
export interface FoundryDocument {
  id: string;
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each game system shapes its own data
  system: any;
  getFlag(scope: string, key: string): unknown;
  setFlag(scope: string, key: string, value: unknown): Promise<unknown>;
  unsetFlag(scope: string, key: string): Promise<unknown>;
  update(data: Record<string, unknown>): Promise<unknown>;
  delete(): Promise<unknown>;
  toObject(): Record<string, unknown>;
}

/** A Foundry collection of documents, such as `game.actors` or `actor.items`. */
export interface FoundryCollection<T> extends Iterable<T> {
  get(id: string): T | undefined;
  contents: T[];
  size: number;
}

/** An actor, with its items and embedded-document methods. */
export interface FoundryActor extends FoundryDocument {
  items: FoundryCollection<FoundryDocument>;
  createEmbeddedDocuments(embeddedName: string, data: Record<string, unknown>[]): Promise<FoundryDocument[]>;
  updateEmbeddedDocuments(embeddedName: string, updates: Record<string, unknown>[]): Promise<FoundryDocument[]>;
  deleteEmbeddedDocuments(embeddedName: string, ids: string[]): Promise<FoundryDocument[]>;
}

/** Options for the waiting helpers. */
export interface WaitOptions {
  /** Default 30 seconds. */
  timeout?: number;
}

const DEFAULT_WAIT_MS = 30_000;

/** An actor in the page, for running code next to it or waiting on it. */
export interface PageActor {
  /** Runs `fn(actor, arg)` in the page and returns its (serializable) result. */
  evaluate<R, A = undefined>(fn: (actor: FoundryActor, arg: A) => R | Promise<R>, arg?: A): Promise<R>;
  /** Waits until `condition(actor, arg)` is true; a missing actor counts as false. */
  waitFor<A = undefined>(
    condition: (actor: FoundryActor, arg: A) => boolean,
    arg?: A,
    options?: WaitOptions
  ): Promise<void>;
  /** The actor's id. */
  id(): Promise<string>;
}

/**
 * The actor `ref` names, for evaluating or waiting on. Flag values are
 * compared with `===`, so match on a string or number flag.
 */
export function actorOn(page: Page, ref: ActorRef): PageActor {
  return {
    evaluate: (fn, arg) => page.evaluate(evaluateActorSource(ref, fn.toString(), arg)),
    waitFor: async (condition, arg, options) => {
      await page.waitForFunction(actorConditionSource(ref, condition.toString(), arg), undefined, {
        timeout: options?.timeout ?? DEFAULT_WAIT_MS,
      });
    },
    id: () => page.evaluate(evaluateActorSource(ref, "(actor) => actor.id", undefined)),
  };
}

/** Waits until a world or client setting holds `value` (compared as JSON). */
export async function waitForSetting(
  page: Page,
  setting: { scope: string; key: string; value: unknown },
  options?: WaitOptions
): Promise<void> {
  await page.waitForFunction(
    ({ scope, key, expected }) => {
      const g = globalThis as unknown as { game: { settings: { get(scope: string, key: string): unknown } } };
      return JSON.stringify(g.game.settings.get(scope, key)) === expected;
    },
    { scope: setting.scope, key: setting.key, expected: JSON.stringify(setting.value) },
    { timeout: options?.timeout ?? DEFAULT_WAIT_MS }
  );
}

/** Creates documents of any type (`"Actor"`, `"Item"`, `"JournalEntry"`, …); returns their ids. */
export async function createDocuments(
  page: Page,
  documentName: string,
  data: Record<string, unknown>[]
): Promise<string[]> {
  return (await documentOperation(page, { operation: "create", documentName, payload: data })) as string[];
}

/** Updates documents of any type; each update names its document with `_id`. */
export async function updateDocuments(
  page: Page,
  documentName: string,
  updates: Array<{ _id: string } & Record<string, unknown>>
): Promise<void> {
  await documentOperation(page, { operation: "update", documentName, payload: updates });
}

/** Deletes documents of any type by id. */
export async function deleteDocuments(page: Page, documentName: string, ids: string[]): Promise<void> {
  await documentOperation(page, { operation: "delete", documentName, payload: ids });
}

interface DocumentOperation {
  operation: "create" | "update" | "delete";
  documentName: string;
  payload: unknown[];
}

/**
 * Runs a create, update, or delete through the document class in CONFIG
 * (Foundry 12 declares the classes in classic scripts, so they are not
 * globals). Playwright sends only this callback to the page, so the lookup
 * lives inside it.
 */
async function documentOperation(page: Page, request: DocumentOperation): Promise<unknown> {
  return page.evaluate(async ({ operation, documentName, payload }) => {
    type DocumentClass = Record<
      "createDocuments" | "updateDocuments" | "deleteDocuments",
      (input: unknown[]) => Promise<unknown>
    >;
    const config = (globalThis as unknown as { CONFIG: Record<string, { documentClass?: DocumentClass }> }).CONFIG;
    const documentClass = config[documentName]?.documentClass;
    if (!documentClass) throw new Error(`${operation}Documents: Foundry has no document type "${documentName}"`);
    if (operation === "create") {
      const created = (await documentClass.createDocuments(payload)) as Array<{ id: string }>;
      return created.map((document) => document.id);
    }
    await documentClass[`${operation}Documents`](payload);
    return null;
  }, request);
}

/**
 * Page side: the actor `ref` names, or null. Its source is sent to the page,
 * so it may only use page globals.
 */
export function findActorInPage(ref: ActorRef): FoundryActor | null {
  const actors = (globalThis as unknown as { game: { actors: FoundryCollection<FoundryActor> } }).game.actors;
  if ("id" in ref) return actors.get(ref.id) ?? null;
  if ("name" in ref) return actors.contents.find((actor) => actor.name === ref.name) ?? null;
  const { scope, key, value } = ref.flag;
  return actors.contents.find((actor) => actor.getFlag(scope, key) === value) ?? null;
}

/** Page source that finds the actor and resolves to `fn(actor, arg)`; rejects when it is missing. */
export function evaluateActorSource(ref: ActorRef, fnSource: string, arg: unknown): string {
  return `(async () => {
  const actor = (${findActorInPage.toString()})(${JSON.stringify(ref)});
  if (!actor) throw new Error(${JSON.stringify(`actorOn: no actor matches ${JSON.stringify(ref)}`)});
  return (${fnSource})(actor, ${serializeArgument(arg)});
})()`;
}

/** Page source that is `condition(actor, arg)`, or false while the actor is missing. */
export function actorConditionSource(ref: ActorRef, conditionSource: string, arg: unknown): string {
  return `(() => {
  const actor = (${findActorInPage.toString()})(${JSON.stringify(ref)});
  return actor ? Boolean((${conditionSource})(actor, ${serializeArgument(arg)})) : false;
})()`;
}

function serializeArgument(arg: unknown): string {
  return arg === undefined ? "undefined" : JSON.stringify(arg);
}
