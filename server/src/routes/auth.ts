import { Router } from "express";
import { hashPassword, verifyPassword } from "../auth/password";
import { requireAuth, type AuthedRequest } from "../auth/middleware";
import { isUsingDevAuthSecret, signAuthToken } from "../auth/token";
import { sendError } from "../errors";
import {
  createUser,
  findUserByEmail,
  publicUser,
  UserExistsError,
} from "../users/store";
import { validateLoginBody } from "../validation/login";
import { validateRegisterBody } from "../validation/register";

export const authRouter = Router();

function authResponse(user: { id: string; email: string; createdAt: string }) {
  return {
    ok: true,
    token: signAuthToken(user),
    user,
  };
}

authRouter.post("/register", async (req, res, next) => {
  try {
    const parsed = validateRegisterBody(req.body);
    if (!parsed.ok) {
      sendError(
        res,
        400,
        "VALIDATION_ERROR",
        "Invalid registration input",
        parsed.details
      );
      return;
    }

    const passwordHash = await hashPassword(parsed.value.password);
    const user = await createUser(parsed.value.email, passwordHash);
    res.status(201).json(authResponse(user));
  } catch (err) {
    if (err instanceof UserExistsError) {
      sendError(
        res,
        409,
        "USER_EXISTS",
        "An account with this email already exists"
      );
      return;
    }
    next(err);
  }
});

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

    const stored = await findUserByEmail(parsed.value.email);
    if (!stored) {
      sendError(res, 401, "INVALID_CREDENTIALS", "Email or password is wrong");
      return;
    }

    const ok = await verifyPassword(parsed.value.password, stored.passwordHash);
    if (!ok) {
      sendError(res, 401, "INVALID_CREDENTIALS", "Email or password is wrong");
      return;
    }

    res.json(authResponse(publicUser(stored)));
  } catch (err) {
    next(err);
  }
});

authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  const user = req.user!;
  res.json({
    ok: true,
    user: { id: user.id, email: user.email },
    devSecretWarning: isUsingDevAuthSecret(),
  });
});
