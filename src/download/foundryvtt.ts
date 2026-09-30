/**
 * Downloading a Foundry VTT Node.js build with a foundryvtt.com account:
 * fetch the CSRF token, log in for a session cookie, ask the release
 * endpoint for a short-lived presigned URL, and stream the zip to disk.
 *
 * The flow mirrors the one felddy/foundryvtt-docker has used for years.
 */
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export const FOUNDRY_SITE = "https://foundryvtt.com";

export type Fetch = typeof fetch;

export interface FoundryCredentials {
  username: string;
  password: string;
}

/** Cookies set by foundryvtt.com, kept across requests. */
export class CookieJar {
  private readonly cookies = new Map<string, string>();

  /** Records the Set-Cookie headers of a response. */
  store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const separator = pair.indexOf("=");
      if (separator > 0) this.cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
    }
  }

  get(name: string): string | undefined {
    return this.cookies.get(name);
  }

  /** The Cookie request header value. */
  header(): string {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }
}

/** The build number of a Foundry version, e.g. "14.367" → "367". */
export function buildNumber(version: string): string {
  const build = version.split(".").pop() ?? "";
  if (!/^\d+$/.test(build)) throw new Error(`buildNumber: cannot read a build number from version "${version}"`);
  return build;
}

/** Extracts the login form's CSRF middleware token from the site's HTML. */
export function extractCsrfToken(html: string): string {
  const input = html.match(/<input[^>]*name=["']csrfmiddlewaretoken["'][^>]*>/i)?.[0];
  const token = input?.match(/value=["']([^"']+)["']/i)?.[1];
  if (!token) throw new Error("extractCsrfToken: no csrfmiddlewaretoken found on foundryvtt.com");
  return token;
}

/** A foundryvtt.com session: requests carry the jar's cookies. */
export class FoundrySession {
  constructor(
    private readonly fetchImpl: Fetch = fetch,
    readonly cookies: CookieJar = new CookieJar()
  ) {}

  /** Requests a site path with the session's cookies, without following redirects. */
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await this.fetchImpl(`${FOUNDRY_SITE}${path}`, {
      ...init,
      redirect: "manual",
      headers: { Referer: `${FOUNDRY_SITE}/`, Cookie: this.cookies.header(), ...init.headers },
    });
    this.cookies.store(response);
    return response;
  }

  /** Logs in; throws when the site does not grant a session. */
  async logIn(credentials: FoundryCredentials): Promise<void> {
    const home = await this.request("/");
    if (!home.ok) throw new Error(`logIn: foundryvtt.com returned ${home.status} for the home page`);
    const form = new URLSearchParams({
      csrfmiddlewaretoken: extractCsrfToken(await home.text()),
      next: "/",
      username: credentials.username,
      password: credentials.password,
    });
    await this.request("/auth/login/", {
      method: "POST",
      body: form,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (!this.cookies.get("sessionid")) {
      throw new Error(
        `logIn: foundryvtt.com did not accept the login for ${credentials.username}; check the credentials`
      );
    }
  }

  /** Asks for the presigned download URL of a Node.js build. */
  async releaseUrl(version: string): Promise<string> {
    const response = await this.request(
      `/releases/download?build=${buildNumber(version)}&platform=node&response_type=json`
    );
    if (response.status !== 200) {
      throw new Error(
        `releaseUrl: foundryvtt.com returned ${response.status} for build ${version}; is it licensed to this account?`
      );
    }
    const body = (await response.json()) as { url?: string };
    if (!body.url) throw new Error(`releaseUrl: no download URL in the response for build ${version}`);
    return body.url;
  }
}

/** Streams a URL to `destination`, via a temporary file so partial downloads never land. */
export async function downloadFile(url: string, destination: string, fetchImpl: Fetch = fetch): Promise<void> {
  const response = await fetchImpl(url);
  if (!response.ok || !response.body) {
    throw new Error(`downloadFile: download failed with ${response.status} ${response.statusText}`);
  }
  const partial = `${destination}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(partial));
    await rename(partial, destination);
  } catch (failure) {
    await rm(partial, { force: true });
    throw failure;
  }
}

/** Logs in and downloads the Node.js build of `version` to `destination`. */
export async function downloadFoundryBuild(
  credentials: FoundryCredentials,
  version: string,
  destination: string,
  fetchImpl: Fetch = fetch
): Promise<void> {
  const session = new FoundrySession(fetchImpl);
  await session.logIn(credentials);
  await downloadFile(await session.releaseUrl(version), destination, fetchImpl);
}
