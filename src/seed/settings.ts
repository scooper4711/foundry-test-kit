/**
 * Resolving the module settings a seeded world gets, from the config's
 * literal values and environment variable references.
 */
import type { SeedSetting } from "../config.js";

/** Settings to write: literal values, plus env-sourced ones whose variable is set. */
export function resolveSettings(settings: SeedSetting[], env: NodeJS.ProcessEnv): { key: string; value: unknown }[] {
  return settings.flatMap((setting) => {
    if (setting.fromEnv) {
      const value = env[setting.fromEnv];
      return value ? [{ key: setting.key, value }] : [];
    }
    return [{ key: setting.key, value: setting.value }];
  });
}

/** Env variables referenced by settings but not set (so those settings are skipped). */
export function missingSettingVariables(settings: SeedSetting[], env: NodeJS.ProcessEnv): string[] {
  return settings.flatMap((setting) => (setting.fromEnv && !env[setting.fromEnv] ? [setting.fromEnv] : []));
}
