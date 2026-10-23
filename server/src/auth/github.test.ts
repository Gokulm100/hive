import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  githubAuthorizeUrl,
  maybeForwardOAuthCallback,
  oauthCallbackUrl,
} from "./github.ts";

const TOUCHED = [
  "GITHUB_CLIENT_ID",
  "GITHUB_CLIENT_SECRET",
  "GITHUB_CALLBACK_URL",
  "HIVE_APP_URL",
  "VITE_APP_URL",
  "PORT",
] as const;

const prev: Record<string, string | undefined> = {};

function setEnv(vars: Record<string, string | undefined>): void {
  for (const key of TOUCHED) {
    if (!(key in prev)) prev[key] = process.env[key];
  }
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const key of TOUCHED) {
    const value = prev[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("oauthCallbackUrl", () => {
  it("omits redirect_uri in production so GitHub uses the registered callback", () => {
    setEnv({
      HIVE_APP_URL: "https://hive-sepia-chi.vercel.app",
      GITHUB_CALLBACK_URL: undefined,
      VITE_APP_URL: undefined,
    });
    assert.equal(oauthCallbackUrl(), null);
  });

  it("does not send the Vercel SPA URL even if GITHUB_CALLBACK_URL points there", () => {
    setEnv({
      HIVE_APP_URL: "https://hive-sepia-chi.vercel.app",
      GITHUB_CALLBACK_URL:
        "https://hive-sepia-chi.vercel.app/api/auth/github/callback",
    });
    assert.equal(oauthCallbackUrl(), null);
  });

  it("honors an explicit Render callback", () => {
    setEnv({
      HIVE_APP_URL: "https://hive-sepia-chi.vercel.app",
      GITHUB_CALLBACK_URL:
        "https://hive-efc7.onrender.com/api/auth/github/callback",
    });
    assert.equal(
      oauthCallbackUrl(),
      "https://hive-efc7.onrender.com/api/auth/github/callback"
    );
  });

  it("sends the local API callback in development", () => {
    setEnv({
      HIVE_APP_URL: "http://localhost:5173",
      GITHUB_CALLBACK_URL: undefined,
      PORT: "8787",
    });
    assert.equal(
      oauthCallbackUrl(),
      "http://localhost:8787/api/auth/github/callback"
    );
  });
});

describe("githubAuthorizeUrl", () => {
  it("does not include redirect_uri or OAuth-App scopes for a GitHub App in prod", () => {
    setEnv({
      HIVE_APP_URL: "https://hive-sepia-chi.vercel.app",
      GITHUB_CALLBACK_URL: undefined,
      GITHUB_CLIENT_ID: "Iv23ct31SdqzyO1fUQh4",
    });
    const url = new URL(githubAuthorizeUrl("state-token"));
    assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
    assert.equal(url.searchParams.get("client_id"), "Iv23ct31SdqzyO1fUQh4");
    assert.equal(url.searchParams.get("redirect_uri"), null);
    assert.equal(url.searchParams.get("scope"), null);
    assert.equal(url.searchParams.get("state"), "state-token");
  });

  it("keeps user scopes for a classic OAuth App", () => {
    setEnv({
      HIVE_APP_URL: "https://hive-sepia-chi.vercel.app",
      GITHUB_CLIENT_ID: "abc123oauth",
    });
    const url = new URL(githubAuthorizeUrl("s"));
    assert.equal(url.searchParams.get("scope"), "read:user user:email");
  });
});

describe("maybeForwardOAuthCallback", () => {
  it("forwards homepage code+state to the API callback", () => {
    let redirected: string | null = null;
    const req = {
      method: "GET",
      path: "/",
      query: { code: "abc", state: "xyz" },
    };
    const res = {
      setHeader() {},
      redirect(url: string) {
        redirected = url;
      },
    };
    const handled = maybeForwardOAuthCallback(
      req as never,
      res as never
    );
    assert.equal(handled, true);
    assert.equal(redirected, "/api/auth/github/callback?code=abc&state=xyz");
  });

  it("does not intercept the real callback path", () => {
    const req = {
      method: "GET",
      path: "/api/auth/github/callback",
      query: { code: "abc", state: "xyz" },
    };
    const res = {
      setHeader() {
        assert.fail("should not set headers");
      },
      redirect() {
        assert.fail("should not redirect");
      },
    };
    assert.equal(maybeForwardOAuthCallback(req as never, res as never), false);
  });
});
