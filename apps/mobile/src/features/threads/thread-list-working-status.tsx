import { formatWorkingDurationLabel } from "@supaterm/client-runtime/state/thread-timing";
import { memo, useEffect, useState } from "react";
import { AppState } from "react-native";
import { AppText } from "../../components/ui/AppText";

/** The clock updates only this label, leaving the row and its subscriptions idle. */
export const ThreadListWorkingStatus = memo(function ThreadListWorkingStatus(props: {
  readonly label: string;
  readonly startedAt: string | null;
  readonly className: string;
}) {
  const startedMs = props.startedAt === null ? Number.NaN : Date.parse(props.startedAt);
  const [duration, setDuration] = useState(() =>
    Number.isFinite(startedMs) ? formatWorkingDurationLabel(Date.now() - startedMs) : null,
  );

  useEffect(() => {
    if (!Number.isFinite(startedMs)) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => setDuration(formatWorkingDurationLabel(Date.now() - startedMs));
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const sync = (state = AppState.currentState) => {
      stop();
      if (state !== "active") return;
      update();
      timer = setInterval(update, 1_000);
    };
    sync();
    const subscription = AppState.addEventListener("change", sync);
    return () => {
      stop();
      subscription.remove();
    };
  }, [startedMs]);

  return (
    <AppText className={props.className} style={{ fontVariant: ["tabular-nums"] }}>
      {props.label}
      {Number.isFinite(startedMs) && duration !== null ? ` ${duration}` : null}
    </AppText>
  );
});
