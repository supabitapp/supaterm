import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

export function userInputCountdown(
  deadline: string | null | undefined,
  now: number,
  resolve: MFunctionType = mFallback,
) {
  if (deadline == null) return null;
  const expiresAt = Date.parse(deadline);
  if (!Number.isFinite(expiresAt)) return null;
  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1_000));
  if (remaining === 0)
    return {
      state: "closing" as const,
      text: resolve(msg("Closing…")),
      shortText: resolve(msg("Closing…")),
      label: resolve(msg("Waiting for this question to close without an answer.")),
    };
  const time = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  return {
    state: remaining <= 20 ? ("warning" as const) : ("counting" as const),
    text: resolve(msg("Closes in {time}", { time })),
    shortText: time,
    label: resolve(msg("Question closes without an answer in {remaining} seconds.", { remaining })),
  };
}
