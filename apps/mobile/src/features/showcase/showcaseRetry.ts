export interface ShowcaseRetryOptions {
  readonly isCancelled: () => boolean;
  readonly attemptTimeoutMs?: number;
  readonly retryDelayMs?: number;
}

const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRY_DELAY_MS = 500;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms)) satisfies Promise<void>;
}

async function runAttemptWithTimeout(operation: () => Promise<boolean>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation(),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } catch {
    return false;
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}

export async function retryShowcaseOperation(
  operation: () => Promise<boolean>,
  options: ShowcaseRetryOptions,
) {
  const attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  while (!options.isCancelled()) {
    if (await runAttemptWithTimeout(operation, attemptTimeoutMs)) return true;
    if (!options.isCancelled()) await delay(retryDelayMs);
  }
  return false;
}
