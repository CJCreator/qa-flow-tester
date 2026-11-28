/** Waits `ms` milliseconds; a zero or negative wait resolves at once. */
export function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits for `task` to finish, but no longer than `ms`: a task that rejects or hangs never stops the caller.
 * Always resolves with nothing, and clears its timer. The task itself is not cancelled.
 */
export async function settleOrGiveUp(task: PromiseLike<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const giveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([Promise.resolve(task).then(undefined, () => {}), giveUp]);
  } finally {
    clearTimeout(timer);
  }
}
