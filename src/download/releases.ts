/**
 * Resolving the symbolic version "latest" to the newest stable Foundry
 * release, from the public release notes list on foundryvtt.com.
 */
import { FOUNDRY_SITE, type Fetch } from "./foundryvtt.js";

export const LATEST = "latest";

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

/** The newest stable version listed. */
export function latestStableVersion(releases: ReleaseEntry[]): string {
  const stable = releases.filter((release) => release.stable).map((release) => release.version);
  if (stable.length === 0) throw new Error("latestStableVersion: no stable releases listed on foundryvtt.com");
  return stable.sort(compareVersions).at(-1) as string;
}

/** Resolves "latest" to the newest stable release; other versions pass through. */
export async function resolveVersion(version: string, fetchImpl: Fetch = fetch): Promise<string> {
  if (version !== LATEST) return version;
  const response = await fetchImpl(`${FOUNDRY_SITE}/releases/`);
  if (!response.ok) {
    throw new Error(`resolveVersion: foundryvtt.com returned ${response.status} for the release list`);
  }
  return latestStableVersion(parseReleases(await response.text()));
}
