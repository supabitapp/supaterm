export function mobileApplicationStateWakeup(previous: string | null | undefined, current: string) {
  if (previous === current) return null;
  if (current === "background") return "application-background";
  if (current === "active") return "application-resumed";
  return null;
}
