import { Router } from "express";
import {
  authStatus,
  finishGitHubOAuth,
  startGitHubOAuth,
} from "../auth/github";
import { clearSession, getSessionUser } from "../auth/session";
export const authRouter = Router();

authRouter.get("/status", authStatus);

authRouter.get("/me", (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({
      error: "Sign in required",
      code: "SESSION_EXPIRED",
    });
    return;
  }
  res.json({ user });
});

authRouter.get("/github", startGitHubOAuth);

authRouter.get("/github/callback", (req, res) => {
  void finishGitHubOAuth(req, res);
});

authRouter.post("/logout", (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});
