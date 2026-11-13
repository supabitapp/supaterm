import { toServerClock } from "@supaterm/client-runtime/clock";
import { formatWorkingDurationLabel } from "@supaterm/client-runtime/state/thread-timing";
import type { EnvironmentId } from "@supaterm/contracts";
import { memo, useEffect, useState } from "react";
import { AppState, Platform, Text as RNText } from "react-native";
import { AppText } from "../../components/ui/AppText";

// DM Sans has no tabular figures, so a ticking timer in it reflows the row every second.
const TABULAR_DURATION_STYLE = {
  fontFamily: Platform.OS === "ios" ? "System" : "sans-serif",
  fontWeight: "700",
  fontVariant: ["tabular-nums"],
} as const;

/** The clock updates only this label, leaving the row and its subscriptions idle. */
export const ThreadListWorkingStatus = memo(function ThreadListWorkingStatus(props: {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly startedAt: string | null;
  readonly className: string;
}) {
  const startedMs = props.startedAt === null ? Number.NaN : Date.parse(props.startedAt);
  const { environmentId } = props;
  const elapsedLabel = () =>
    formatWorkingDurationLabel(toServerClock(environmentId, Date.now()) - startedMs);
  const [duration, setDuration] = useState(() =>
    Number.isFinite(startedMs) ? elapsedLabel() : null,
  );

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- runs the duration clock interval only while AppState is active and follows app state changes
  useEffect(() => {
    if (!Number.isFinite(startedMs)) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = () => setDuration(elapsedLabel());
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
  }, [environmentId, startedMs]);

  return (
    <AppText className={props.className}>
      {props.label}
      {Number.isFinite(startedMs) && duration !== null ? (
        <>
          {" "}
          <RNText style={TABULAR_DURATION_STYLE}>{duration}</RNText>
        </>
      ) : null}
    </AppText>
  );
});
