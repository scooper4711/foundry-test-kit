import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CookieJar,
  FoundrySession,
  buildNumber,
  downloadFile,
  downloadFoundryBuild,
  extractCsrfToken,
  isRetryable,
  releaseFailure,
  retryDelay,
  type Fetch,
  type RetryPolicy,
} from "../src/download/foundryvtt.js";

const HOME_PAGE = `<form><input type="hidden" name="csrfmiddlewaretoken" value="form-token-123"></form>`;
const PRESIGNED = "https://r2.example.com/FoundryVTT-Node-14.367.zip?sig=abc";

interface Call {
  url: string;
  init?: RequestInit;
}

/** A fake foundryvtt.com: records calls and answers each route. */
function fakeSite(
  options: { acceptLogin?: boolean; releaseStatus?: number; releaseStatuses?: number[]; retryAfter?: string } = {}
): { fetch: Fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://foundryvtt.com/") {
      return new Response(HOME_PAGE, { headers: { "Set-Cookie": "csrftoken=cookie-token; Path=/" } });
    }
    if (url.endsWith("/auth/login/")) {
      const headers = new Headers({ Location: "/" });
      if (options.acceptLogin !== false) headers.append("Set-Cookie", "sessionid=session-456; HttpOnly; Path=/");
      return new Response(null, { status: 302, headers });
    }
    if (url.includes("/releases/download")) {
      const status = options.releaseStatuses?.shift() ?? options.releaseStatus ?? 200;
      const headers = options.retryAfter ? { "Retry-After": options.retryAfter } : undefined;
      return new Response(status === 200 ? JSON.stringify({ url: PRESIGNED, lifetime: 300 }) : "", {
        status,
        headers,
      });
    }
    if (url === PRESIGNED) return new Response("zip-bytes");
    return new Response("not found", { status: 404 });
  };
  return { fetch: fetchImpl as Fetch, calls };
}

describe("buildNumber", () => {
  it("reads the build from a version", () => {
    expect(buildNumber("14.367")).toBe("367");
    expect(() => buildNumber("latest")).toThrow(/build number/);
  });
});

describe("extractCsrfToken", () => {
  it("finds the login form token in either attribute order", () => {
    expect(extractCsrfToken(HOME_PAGE)).toBe("form-token-123");
    expect(extractCsrfToken(`<input value='v2' name='csrfmiddlewaretoken'/>`)).toBe("v2");
    expect(() => extractCsrfToken("<html></html>")).toThrow(/csrfmiddlewaretoken/);
  });
});

describe("CookieJar", () => {
  it("keeps name=value pairs from Set-Cookie headers", () => {
    const jar = new CookieJar();
    const headers = new Headers();
    headers.append("Set-Cookie", "a=1; Path=/");
    headers.append("Set-Cookie", "b=2=x; HttpOnly");
    jar.store(new Response(null, { headers }));
    expect(jar.get("b")).toBe("2=x");
    expect(jar.header()).toBe("a=1; b=2=x");
  });
});

describe("FoundrySession", () => {
  it("logs in with the form token and cookies, then fetches the release URL", async () => {
    const site = fakeSite();
    const session = new FoundrySession(site.fetch);

    await session.logIn({ username: "gm@example.com", password: "hunter2" });
    const url = await session.releaseUrl("14.367");

    expect(url).toBe(PRESIGNED);
    const login = site.calls[1];
    expect(login.init?.method).toBe("POST");
    const form = new URLSearchParams(String(login.init?.body));
    expect(Object.fromEntries(form)).toEqual({
      csrfmiddlewaretoken: "form-token-123",
      next: "/",
      username: "gm@example.com",
      password: "hunter2",
    });
    expect((login.init?.headers as Record<string, string>).Cookie).toBe("csrftoken=cookie-token");
    expect(site.calls[2].url).toBe(
      "https://foundryvtt.com/releases/download?build=367&platform=node&response_type=json"
    );
    expect((site.calls[2].init?.headers as Record<string, string>).Cookie).toContain("sessionid=session-456");
  });

  it("reports rejected credentials", async () => {
    const session = new FoundrySession(fakeSite({ acceptLogin: false }).fetch);
    await expect(session.logIn({ username: "gm", password: "wrong" })).rejects.toThrow(/did not accept the login/);
  });

  it("reports a build the account cannot download", async () => {
    const session = new FoundrySession(fakeSite({ releaseStatus: 403 }).fetch);
    await session.logIn({ username: "gm", password: "pw" });
    await expect(session.releaseUrl("14.999")).rejects.toThrow(/returned 403.*licensed/);
  });

  it("waits out rate limiting, honouring Retry-After", async () => {
    const retry = recordingRetry();
    const site = fakeSite({ releaseStatuses: [429, 503], retryAfter: "7" });
    const session = new FoundrySession(site.fetch, undefined, retry.policy);
    await session.logIn({ username: "gm", password: "pw" });
    expect(await session.releaseUrl("14.367")).toBe(PRESIGNED);
    expect(retry.waits).toEqual([7000, 7000]);
  });

  it("gives up after its attempts and says it was rate limited", async () => {
    const retry = recordingRetry();
    const session = new FoundrySession(fakeSite({ releaseStatus: 429 }).fetch, undefined, retry.policy);
    await session.logIn({ username: "gm", password: "pw" });
    await expect(session.releaseUrl("12.343")).rejects.toThrow(/rate limiting downloads \(429\)/);
    expect(retry.waits).toEqual([1000, 2000]);
  });
});

describe("retry helpers", () => {
  it("retries rate limiting and server errors only", () => {
    expect([429, 500, 503, 200, 302, 403, 404].map(isRetryable)).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
  });

  it("backs off exponentially without Retry-After, and caps long waits", () => {
    expect(retryDelay(new Response(null, { status: 429 }), 3, 30_000)).toBe(120_000);
    const patient = new Response(null, { status: 429, headers: { "Retry-After": "3600" } });
    expect(retryDelay(patient, 1, 30_000)).toBe(300_000);
  });

  it("explains other release failures by status", () => {
    expect(releaseFailure(500, "14.1")).toBe("releaseUrl: foundryvtt.com returned 500 for build 14.1");
  });
});

/** A three-attempt retry policy that records its waits instead of sleeping. */
function recordingRetry(): { policy: RetryPolicy; waits: number[] } {
  const waits: number[] = [];
  return { waits, policy: { attempts: 3, baseDelayMs: 1000, sleep: async (ms) => void waits.push(ms) } };
}

describe("downloadFoundryBuild", () => {
  it("saves the build to the destination", async () => {
    const destination = join(mkdtempSync(join(tmpdir(), "kit-download-")), "FoundryVTT-Node-14.367.zip");
    await downloadFoundryBuild({ username: "gm", password: "pw" }, "14.367", destination, fakeSite().fetch);
    expect(readFileSync(destination, "utf8")).toBe("zip-bytes");
  });

  it("leaves no partial file when the download fails", async () => {
    const destination = join(mkdtempSync(join(tmpdir(), "kit-download-")), "broken.zip");
    await expect(downloadFile("https://nowhere.example.com/x.zip", destination, fakeSite().fetch)).rejects.toThrow(
      /404/
    );
    expect(existsSync(destination)).toBe(false);
    expect(existsSync(`${destination}.part`)).toBe(false);
  });
});
