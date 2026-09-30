/**
 * Inputs for seeding a Foundry data directory, and the display names the
 * setup screens use for game systems.
 */
import type { SeedSetting } from "../config.js";

export interface SeedOptions {
  baseUrl: string;
  licenseKey: string;
  adminPassword: string;
  /** Game system package ids to install, e.g. ["pf2e", "sf2e"]. */
  systemIds: string[];
  /** System the world is created with (one of systemIds). */
  worldSystem: string;
  worldTitle: string;
  moduleId: string;
  /** Module settings written once the module is enabled. */
  settings: SeedSetting[];
  playerName: string;
}

/** Display names as shown in the Foundry setup package and world lists. */
const SYSTEM_DISPLAY_NAMES: Record<string, string> = {
  pf2e: "Pathfinder Second Edition",
  sf2e: "Starfinder Second Edition",
  dnd5e: "Dungeons & Dragons Fifth Edition",
};

export function systemDisplayName(systemId: string): string {
  return SYSTEM_DISPLAY_NAMES[systemId] ?? systemId;
}

/** Logs a seeding step. */
export function log(message: string): void {
  console.log(message);
}
