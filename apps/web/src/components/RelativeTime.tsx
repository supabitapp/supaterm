import { useRelativeTimeState } from "../hooks/useRelativeTimeState";

export function RelativeTime(props: { timestamp: string }) {
  const relative = useRelativeTimeState(props.timestamp);
  if (relative.status !== "relative") return null;
  return relative.suffix ? `${relative.value} ${relative.suffix}` : relative.value;
}
