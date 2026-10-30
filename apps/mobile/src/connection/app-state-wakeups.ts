import type { Wakeups } from "@supaterm/client-runtime/connection";

export function mobileApplicationStateWakeup(
  previous: string | null | undefined,
  current: string,
): Extract<Wakeups.ConnectionWakeup, "application-resumed" | "application-background"> | null {
  if (previous === current) return null;
  if (current === "background") return "application-background";
  if (current === "active") return "application-resumed";
  return null;
}
