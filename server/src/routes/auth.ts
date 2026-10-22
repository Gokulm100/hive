import { Router } from "express";
import { verifyPassword } from "../auth/password";
import {
  createSession,
  destroySession,
  readSessionId,
} from "../auth/session";
import { sendError } from "../errors";
import { findUserByEmail, findUserById, publicUser } from "../users/store";
import { validateLoginBody } from "../validation/login";
import { registerRouter } from "./register";

export const authRouter = Router();

authRouter.use("/register", registerRouter);

authRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = validateLoginBody(req.body);
    if (!parsed.ok) {
      sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Invalid login input",
        parsed.details
      );
      return;
    }

    const user = await findUserByEmail(parsed.value.email);
    if (!user) {
      sendError(res, 401, "INVALID_CREDENTIALS", "Email or password is wrong");
      return;
    }

    const ok = await verifyPassword(parsed.value.password, user.passwordHash);
    if (!ok) {
      sendError(res, 401, "INVALID_CREDENTIALS", "Email or password is wrong");
      return;
    }

    createSession(user.id, res);
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});

authRouter.post("/logout", (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

authRouter.get("/me", async (req, res, next) => {
  try {
    const userId = readSessionId(req);
    if (!userId) {
      res.json({ ok: true, user: null });
      return;
    }
    const user = await findUserById(userId);
    if (!user) {
      destroySession(req, res);
      res.json({ ok: true, user: null });
      return;
    }
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    next(err);
  }
});
