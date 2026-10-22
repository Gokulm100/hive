import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type StoredUser = {
  id: string;
  email: string;
  passwordHash?: string;
  githubId?: number;
  login?: string;
  avatarUrl?: string;
  createdAt: string;
};

type UserDb = {
  users: StoredUser[];
};

function usersFilePath(): string {
  const fromEnv =
    process.env.HIVE_USERS_FILE?.trim() ||
    process.env.NEXUS_USERS_FILE?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(process.cwd(), "server", "data", "users.json");
}

async function loadDb(): Promise<UserDb> {
  const file = usersFilePath();
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as UserDb;
    if (!Array.isArray(parsed.users)) return { users: [] };
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { users: [] };
    }
    throw err;
  }
}

async function saveDb(db: UserDb): Promise<void> {
  const file = usersFilePath();
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(db, null, 2) + "\n", "utf8");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(
  email: string
): Promise<StoredUser | undefined> {
  const db = await loadDb();
  const key = normalizeEmail(email);
  return db.users.find((u) => u.email === key);
}

export async function findUserByGithubId(
  githubId: number
): Promise<StoredUser | undefined> {
  const db = await loadDb();
  return db.users.find((u) => u.githubId === githubId);
}

export async function upsertGitHubUser(opts: {
  githubId: number;
  login: string;
  email: string | null;
  avatarUrl: string;
}): Promise<StoredUser> {
  const db = await loadDb();
  const existing = db.users.find((u) => u.githubId === opts.githubId);
  if (existing) {
    existing.login = opts.login;
    existing.avatarUrl = opts.avatarUrl;
    if (opts.email) existing.email = normalizeEmail(opts.email);
    await saveDb(db);
    return existing;
  }

  const email =
    opts.email != null && opts.email.trim()
      ? normalizeEmail(opts.email)
      : `${opts.login}@users.noreply.github.com`;

  const user: StoredUser = {
    id: crypto.randomUUID(),
    email,
    githubId: opts.githubId,
    login: opts.login,
    avatarUrl: opts.avatarUrl,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  await saveDb(db);
  return user;
}

export async function createUser(
  email: string,
  passwordHash: string
): Promise<Omit<StoredUser, "passwordHash">> {
  const db = await loadDb();
  const normalized = normalizeEmail(email);
  if (db.users.some((u) => u.email === normalized)) {
    throw new UserExistsError();
  }
  const user: StoredUser = {
    id: crypto.randomUUID(),
    email: normalized,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  await saveDb(db);
  const { passwordHash: _omit, ...publicUser } = user;
  return publicUser;
}

export class UserExistsError extends Error {
  constructor() {
    super("User already exists");
    this.name = "UserExistsError";
  }
}

export function publicUser(user: StoredUser): Omit<StoredUser, "passwordHash"> {
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}
