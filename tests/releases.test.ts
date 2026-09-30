import { describe, expect, it } from "vitest";
import { compareVersions, latestStableVersion, parseReleases, resolveVersion } from "../src/download/releases.js";
import type { Fetch } from "../src/download/foundryvtt.js";

/** Trimmed from https://foundryvtt.com/releases/ (newest first). */
function release(version: string, tags: string[]): string {
  const tagSpans = tags.map((tag) => `<span class="release-tag ${tag.toLowerCase()}">${tag}</span>`).join("\n");
  return `
    <li class="article release flexrow">
      <h3 class="article-title">
        <a href="/releases/${version}" title="Release ${version} Update Notes">Release ${version}</a>
      </h3>
      <span class="release-time">September 16, 2026</span>
      <div class="release-tags">
        <span class="release-tag">Update</span>
        ${tagSpans}
      </div>
    </li>`;
}

const PAGE = `<ul>${release("15.401", ["Testing"])}${release("14.368", ["Stable"])}${release("14.99", ["Stable"])}${release("13.400", ["Stable"])}</ul>`;

describe("parseReleases", () => {
  it("reads each version and whether it is stable", () => {
    expect(parseReleases(PAGE)).toEqual([
      { version: "15.401", stable: false },
      { version: "14.368", stable: true },
      { version: "14.99", stable: true },
      { version: "13.400", stable: true },
    ]);
  });
});

describe("compareVersions", () => {
  it("compares major then build numerically", () => {
    expect(compareVersions("14.368", "14.99")).toBeGreaterThan(0);
    expect(compareVersions("13.400", "14.1")).toBeLessThan(0);
    expect(compareVersions("14.368", "14.368")).toBe(0);
  });
});

describe("latestStableVersion", () => {
  it("skips testing releases and orders numerically", () => {
    expect(latestStableVersion(parseReleases(PAGE))).toBe("14.368");
  });

  it("explains an empty list", () => {
    expect(() => latestStableVersion([])).toThrow(/no stable releases/);
  });
});

describe("resolveVersion", () => {
  const fetchPage = (async () => new Response(PAGE)) as unknown as Fetch;

  it("resolves latest from the release list", async () => {
    expect(await resolveVersion("latest", fetchPage)).toBe("14.368");
  });

  it("passes concrete versions through without fetching", async () => {
    const noFetch = (async () => {
      throw new Error("should not fetch");
    }) as unknown as Fetch;
    expect(await resolveVersion("14.367", noFetch)).toBe("14.367");
  });

  it("reports an unreachable release list", async () => {
    const failing = (async () => new Response("", { status: 503 })) as unknown as Fetch;
    await expect(resolveVersion("latest", failing)).rejects.toThrow(/returned 503/);
  });
});
