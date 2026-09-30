/**
 * The users a seeded world has: its Gamemaster (Foundry creates one with
 * every world; the kit can rename it and give it a password) and any number
 * of extra test users at the permission level each test needs. Configured
 * under `seed` in foundry-test.config.json.
 */

/** Foundry's permission levels, by the names its user configuration uses. */
export type UserRole = "player" | "trusted" | "assistant" | "gamemaster";

/** A user the seeder creates (or updates) in every seeded world. */
export interface SeedUser {
  name: string;
  role: UserRole;
  /** Access key; empty for none. */
  password: string;
}

/** The world's Gamemaster account, which the kit joins as. */
export interface GamemasterAccount {
  name: string;
  /** Access key; empty for none. */
  password: string;
}

export interface SeedUsersConfig {
  gamemaster: GamemasterAccount;
  users: SeedUser[];
}

export type RawSeedUsers = {
  gamemaster?: Partial<GamemasterAccount>;
  users?: Partial<SeedUser>[];
};

/** The name Foundry gives the Gamemaster of a new world. */
export const DEFAULT_GAMEMASTER_NAME = "Gamemaster";
/** The player seeded when the config lists no users. */
export const DEFAULT_PLAYER_NAME = "TestPlayer";

/** Foundry's CONST.USER_ROLES values. */
export const USER_ROLE_LEVELS: Record<UserRole, number> = { player: 1, trusted: 2, assistant: 3, gamemaster: 4 };

/**
 * Fills defaults and validates the seeded users: the Gamemaster defaults to
 * Foundry's own, and a missing user list to one passwordless player. An
 * explicit empty list seeds no extra users.
 */
export function normalizeSeedUsers(raw: RawSeedUsers = {}): SeedUsersConfig {
  const gamemaster = {
    name: raw.gamemaster?.name ?? DEFAULT_GAMEMASTER_NAME,
    password: raw.gamemaster?.password ?? "",
  };
  const users = (raw.users ?? [{ name: DEFAULT_PLAYER_NAME }]).map(toSeedUser);
  assertUniqueNames([gamemaster.name, ...users.map((user) => user.name)]);
  return { gamemaster, users };
}

/**
 * The first configured test user with `role`, for specs that need "a
 * player" without repeating its name.
 */
export function findSeedUser(config: SeedUsersConfig, role: UserRole = "player"): SeedUser {
  const user = config.users.find((candidate) => candidate.role === role);
  if (!user) throw new Error(`findSeedUser: no seed.users entry has role "${role}"`);
  return user;
}

/** The access key of a configured user (the Gamemaster included), or "" for an unknown one. */
export function seedUserPassword(config: SeedUsersConfig, userName: string): string {
  if (userName === config.gamemaster.name) return config.gamemaster.password;
  return config.users.find((user) => user.name === userName)?.password ?? "";
}

function toSeedUser(user: Partial<SeedUser>): SeedUser {
  if (!user.name) throw new Error('normalizeSeedUsers: every seed.users entry needs a "name"');
  const role = user.role ?? "player";
  if (!(role in USER_ROLE_LEVELS)) {
    throw new Error(
      `normalizeSeedUsers: user "${user.name}" has role "${role}"; use ${Object.keys(USER_ROLE_LEVELS).join(", ")}`
    );
  }
  return { name: user.name, role, password: user.password ?? "" };
}

/** Foundry user names are unique within a world. */
function assertUniqueNames(names: string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) throw new Error(`normalizeSeedUsers: user name "${name}" is configured twice`);
    seen.add(name);
  }
}
