const EMAIL_RE =
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type RegisterInput = {
  email: string;
  password: string;
};

export function validateRegisterBody(
  body: unknown
):
  | { ok: true; value: RegisterInput }
  | { ok: false; details: Record<string, string> } {
  if (body === null || typeof body !== "object") {
    return { ok: false, details: { body: "Expected JSON object" } };
  }
  const record = body as Record<string, unknown>;
  const details: Record<string, string> = {};

  const emailRaw = record.email;
  if (typeof emailRaw !== "string" || !emailRaw.trim()) {
    details.email = "Email is required";
  } else if (!EMAIL_RE.test(emailRaw.trim())) {
    details.email = "Invalid email format";
  }

  const passwordRaw = record.password;
  if (typeof passwordRaw !== "string") {
    details.password = "Password is required";
  } else if (passwordRaw.length < 8) {
    details.password = "Password must be at least 8 characters";
  } else if (passwordRaw.length > 128) {
    details.password = "Password must be at most 128 characters";
  }

  if (Object.keys(details).length > 0) {
    return { ok: false, details };
  }

  return {
    ok: true,
    value: {
      email: (emailRaw as string).trim(),
      password: passwordRaw as string,
    },
  };
}
