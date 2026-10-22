import { validateRegisterBody, type RegisterInput } from "./register";

export type LoginInput = RegisterInput;

export function validateLoginBody(
  body: unknown
):
  | { ok: true; value: LoginInput }
  | { ok: false; details: Record<string, string> } {
  return validateRegisterBody(body);
}
