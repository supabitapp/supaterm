import { useSyncExternalStore } from "react";
import { msUntilRelativeTimeChange, relativeTime } from "../lib/time";

export function RelativeTime(props: { timestamp: string }) {
  const subscribe = (onChange: () => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delayMs = msUntilRelativeTimeChange(props.timestamp);
      if (delayMs === null) return;
      timer = setTimeout(() => {
        onChange();
        schedule();
      }, delayMs);
    };
    schedule();
    return () => clearTimeout(timer);
  };
  const getSnapshot = () => relativeTime(props.timestamp);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
