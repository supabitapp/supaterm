import type { Wakeups } from "@supaterm/client-runtime/connection";

export function mobileApplicationStateWakeup(
  previous: string | null | undefined,
  current: string,
  backgroundDurationMs = 0,
): Extract<
  Wakeups.ConnectionWakeup,
  "application-resumed" | "application-active-long" | "application-background"
> | null {
  if (previous === current) return null;
  if (current === "background") return "application-background";
  if (current === "active")
    return backgroundDurationMs >= 10_000 ? "application-active-long" : "application-resumed";
  return null;
}
