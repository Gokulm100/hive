import { Router } from "express";
import {
  authStatus,
  finishGitHubOAuth,
  startGitHubOAuth,
} from "../auth/github";
import {
  clearSession,
  createSession,
  getSessionUser,
  readSessionToken,
  userFromSessionToken,
} from "../auth/session";
export const authRouter = Router();

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
            },
          }
        : {}),
    });
    return;
  }
  res.json({ user });
});

/** Mint a real session + redirect with #h=… — only when x-hive-debug matches client id. */
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
  const sessionToken = createSession(res, user, req);
  const app =
    (process.env.HIVE_APP_URL || process.env.VITE_APP_URL || "").replace(
      /\/$/,
      ""
    ) || "http://localhost:5173";
  res.redirect(`${app}/#h=${encodeURIComponent(sessionToken)}`);
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
