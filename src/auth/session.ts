const TOKEN_KEY = "hive-auth-token";

export function getAccessToken(): string | null {
  try {
    const v = localStorage.getItem(TOKEN_KEY);
    return v?.trim() || null;
  } catch {
    return null;
  }
}

export function setAccessToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAccessToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export type AuthUser = {
  id: string;
  email: string;
};
