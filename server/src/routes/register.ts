import { Router } from "express";
import { hashPassword } from "../auth/password";
import { sendError } from "../errors";
import { createUser, UserExistsError } from "../users/store";
import { validateRegisterBody } from "../validation/register";

export const registerRouter = Router();

registerRouter.post("/", async (req, res, next) => {
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
    res.status(201).json({ ok: true, user });
  } catch (err) {
    if (err instanceof UserExistsError) {
      sendError(res, 409, "USER_EXISTS", "An account with this email already exists");
      return;
    }
    next(err);
  }
});
