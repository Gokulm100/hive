import { Router, type Request, type Response } from "express";
import {
  authStatus,
  finishGitHubOAuth,
  startGitHubOAuth,
} from "../auth/github";
import {
  clearSession,
  createSession,
  getSessionUser,
  mintSessionToken,
  readSessionToken,
  userFromSessionToken,
} from "../auth/session";
export const authRouter = Router();

function appOriginFromEnv(): string {
  return (
    (process.env.HIVE_APP_URL || process.env.VITE_APP_URL || "")
      .trim()
      .replace(/\/$/, "") || "http://localhost:5173"
  );
}

authRouter.get("/status", authStatus);

authRouter.get("/me", (req, res) => {
  const raw = readSessionToken(req);
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({
      error: "Sign in required",
      code: "SESSION_EXPIRED",
      ...(req.query.debug === "1"
        ? {
            debug: {
              hasToken: Boolean(raw),
              tokenLen: raw?.length ?? 0,
              verifyOk: raw ? Boolean(userFromSessionToken(raw)) : false,
              hasCookie: Boolean(
                (req.headers.cookie || "").includes("hive_session=")
              ),
              hasBearer: /^Bearer\s+\S+/i.test(req.get("authorization") || ""),
            },
          }
        : {}),
    });
    return;
  }
  res.json({ user });
});

/**
 * Finish sign-in on the *app* host (Vercel rewrite / Vite proxy).
 * Sets HttpOnly cookie + returns HTML that writes Bearer token to localStorage.
 * Avoids relying on Location #hash / ?h= (often stripped by browsers/extensions).
 */
function claimSession(req: Request, res: Response): void {
  const raw = String(
    (req.body && typeof req.body === "object" && req.body.h) ||
      req.query.h ||
      ""
  ).trim();
  const user = raw ? userFromSessionToken(raw) : null;
  const app = appOriginFromEnv();
  if (!user) {
    res.redirect(`${app}/?auth_error=session_claim_failed`);
    return;
  }
  const sessionToken = createSession(res, user, req);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"/><title>Signing in…</title></head>
<body>
<p>Signing you in…</p>
<script>
try {
  localStorage.setItem("hive_session_token", ${JSON.stringify(sessionToken)});
} catch (e) {}
location.replace(${JSON.stringify(app + "/")});
</script>
</body>
</html>`);
}

authRouter.get("/claim", claimSession);
authRouter.post("/claim", claimSession);

/** Mint a real session + claim redirect — only when x-hive-debug matches client id. */
authRouter.get("/mint-handoff", (req, res) => {
  const expected = (process.env.GITHUB_CLIENT_ID || "").trim();
  if (!expected || req.get("x-hive-debug") !== expected) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const user = {
    id: "mint-handoff",
    email: "mint-handoff@users.noreply.github.com",
    login: "mint-handoff",
    avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
    createdAt: new Date().toISOString(),
  };
  const sessionToken = mintSessionToken(user);
  const claim = `${appOriginFromEnv()}/api/auth/claim`;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(`<!DOCTYPE html>
<html lang="en"><body>
<form id="f" method="POST" action=${JSON.stringify(claim)}>
<input type="hidden" name="h" value=${JSON.stringify(sessionToken)} />
</form>
<script>document.getElementById("f").submit()</script>
</body></html>`);
});

authRouter.get("/github", startGitHubOAuth);

authRouter.get("/github/callback", (req, res) => {
  void finishGitHubOAuth(req, res);
});

/** Temporary bypass while GitHub OAuth is flaky — mints a signed guest session. */
authRouter.post("/guest", (req, res) => {
  const user = {
    id: `guest-${crypto.randomUUID()}`,
    email: "guest@hive.local",
    login: "guest",
    createdAt: new Date().toISOString(),
  };
  const token = createSession(res, user, req);
  res.json({ user, token });
});

authRouter.post("/logout", (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});
