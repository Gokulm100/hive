/** Which account owns the in-flight orchestration on this API process. */
let activeRunUserId: string | null = null;

export function setActiveRunUser(userId: string | null): void {
  activeRunUserId = userId;
}

export function getActiveRunUser(): string | null {
  return activeRunUserId;
}

export function isRunOwnedBy(userId: string): boolean {
  return !activeRunUserId || activeRunUserId === userId;
}
