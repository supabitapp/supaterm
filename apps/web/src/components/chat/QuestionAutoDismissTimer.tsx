import { memo, useEffect, useState } from "react";
import { userInputCountdown } from "@supaterm/client-runtime/user-input-countdown";
import { cn } from "~/lib/utils";

function useUserInputCountdown(deadline: string) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (time >= Date.parse(deadline)) window.clearInterval(timer);
    };
    const timer = window.setInterval(tick, 1_000);
    tick();
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [deadline]);
  return userInputCountdown(deadline, now);
}

export const QuestionAutoDismissCountdown = memo(function QuestionAutoDismissCountdown({
  deadline,
}: {
  deadline: string;
}) {
  const countdown = useUserInputCountdown(deadline);
  if (countdown === null) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "shrink-0 whitespace-nowrap text-muted-foreground tabular-nums",
        countdown.state !== "counting" && "text-warning-foreground",
      )}
    >
      <span className="@max-[400px]:hidden">{countdown.text}</span>
      <span className="@min-[400px]:hidden">{countdown.shortText}</span>
    </span>
  );
});

export const QuestionAutoDismissAnnouncer = memo(function QuestionAutoDismissAnnouncer({
  deadline,
}: {
  deadline: string;
}) {
  const countdown = useUserInputCountdown(deadline);
  if (countdown === null) return null;
  return (
    <div className="sr-only">
      <span role="timer" aria-live="off" aria-label={countdown.label}>
        {countdown.text}
      </span>
      <span role="status">
        {countdown.state === "counting" ? "" : "This question will close without an answer soon."}
      </span>
    </div>
  );
});
