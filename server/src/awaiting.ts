type Waiter = {
  resolve: (answer: string) => void;
  reject: (err: Error) => void;
};

const waiters = new Map<string, Waiter>();

export function isAwaitingAnswers(agentId: string) {
  return waiters.has(agentId);
}

export function waitForAnswers(
  agentId: string,
  timeoutMs = 1000 * 60 * 30
): Promise<string> {
  return new Promise((resolve, reject) => {
    const prev = waiters.get(agentId);
    if (prev) {
      prev.reject(new Error("Replaced by a newer question round"));
    }

    const timer = setTimeout(() => {
      waiters.delete(agentId);
      reject(new Error("Timed out waiting for your answers"));
    }, timeoutMs);

    waiters.set(agentId, {
      resolve: (answer) => {
        clearTimeout(timer);
        waiters.delete(agentId);
        resolve(answer);
      },
      reject: (err) => {
        clearTimeout(timer);
        waiters.delete(agentId);
        reject(err);
      },
    });
  });
}

export function provideAnswers(agentId: string, answer: string): boolean {
  const w = waiters.get(agentId);
  if (!w) return false;
  w.resolve(answer);
  return true;
}

export function rejectAwaiting(agentId: string, err: Error): boolean {
  const w = waiters.get(agentId);
  if (!w) return false;
  w.reject(err);
  waiters.delete(agentId);
  return true;
}

export function rejectAllAwaiting(message = "Stopped by user") {
  for (const [id, w] of waiters) {
    w.reject(new Error(message));
    waiters.delete(id);
  }
}
