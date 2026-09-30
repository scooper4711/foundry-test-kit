/**
 * Resolving symbolic versions — "latest" (newest stable release) and
 * "latest-<major>" (newest stable release of that major, e.g. "latest-13")
 * — from the public release notes list on foundryvtt.com.
 */
import { FOUNDRY_SITE, type Fetch } from "./foundryvtt.js";

const SYMBOLIC_VERSION = /^latest(?:-(\d+))?$/;

/** The oldest Foundry major the kit supports (downloads and seeding). */
export const MIN_SUPPORTED_MAJOR = 12;

/** Throws for versions older than MIN_SUPPORTED_MAJOR or that are not "<major>.<build>". */
export function assertSupportedVersion(version: string): void {
  const major = Number(version.match(/^(\d+)\.\d+$/)?.[1]);
  if (Number.isNaN(major)) throw new Error(`assertSupportedVersion: "${version}" is not a Foundry version like 14.368`);
  if (major < MIN_SUPPORTED_MAJOR) {
    throw new Error(`assertSupportedVersion: Foundry ${version} is not supported (${MIN_SUPPORTED_MAJOR}.x or later)`);
  }
}

export interface ReleaseEntry {
  version: string;
  stable: boolean;
}

/** Reads every release (version and whether it is tagged Stable) from the release notes page. */
export function parseReleases(html: string): ReleaseEntry[] {
  const entries = html.split(/<li[^>]*class="[^"]*\barticle release\b[^"]*"[^>]*>/).slice(1);
  return entries.flatMap((entry) => {
    const version = entry.match(/href="\/releases\/(\d+\.\d+)"/)?.[1];
    if (!version) return [];
    return [{ version, stable: /class="release-tag stable"/.test(entry.split("</li>")[0]) }];
  });
}

/** Orders versions numerically: "14.368" > "14.99" > "13.400". */
export function compareVersions(left: string, right: string): number {
  const [leftMajor, leftBuild] = left.split(".").map(Number);
  const [rightMajor, rightBuild] = right.split(".").map(Number);
  return leftMajor - rightMajor || leftBuild - rightBuild;
}

/** The newest stable version listed, optionally within one major version. */
export function latestStableVersion(releases: ReleaseEntry[], major?: number): string {
  const stable = releases
    .filter((release) => release.stable && (major === undefined || release.version.startsWith(`${major}.`)))
    .map((release) => release.version);
  if (stable.length === 0) {
    const scope = major === undefined ? "" : ` for version ${major}`;
    throw new Error(`latestStableVersion: no stable releases${scope} listed on foundryvtt.com`);
  }
  return stable.sort(compareVersions).at(-1) as string;
}

/** Resolves "latest" / "latest-<major>" to a stable release number; other versions pass through. */
export async function resolveVersion(version: string, fetchImpl: Fetch = fetch): Promise<string> {
  const symbolic = version.match(SYMBOLIC_VERSION);
  if (!symbolic) {
    assertSupportedVersion(version);
    return version;
  }
  const major = symbolic[1] === undefined ? undefined : Number(symbolic[1]);
  if (major !== undefined && major < MIN_SUPPORTED_MAJOR) {
    throw new Error(`resolveVersion: ${version} is not supported (${MIN_SUPPORTED_MAJOR}.x or later)`);
  }
  const response = await fetchImpl(`${FOUNDRY_SITE}/releases/`);
  if (!response.ok) {
    throw new Error(`resolveVersion: foundryvtt.com returned ${response.status} for the release list`);
  }
  return latestStableVersion(parseReleases(await response.text()), major);
}
