import { useLayoutEffect, useState, type ReactNode } from "react";
import { AppState, Pressable, type PressableProps } from "react-native";
import { userInputCountdown } from "@supaterm/client-runtime/user-input-countdown";
import { AppText as Text } from "../../components/ui/AppText";
import { cn } from "../../lib/cn";

function useUserInputCountdown(deadline: string | null) {
  const [now, setNow] = useState(Date.now);
  useLayoutEffect(() => {
    if (deadline === null) return;
    const tick = () => {
      const time = Date.now();
      setNow(time);
      if (time >= Date.parse(deadline)) clearInterval(timer);
    };
    const timer = setInterval(tick, 1_000);
    tick();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") tick();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [deadline]);
  return userInputCountdown(deadline, now);
}

export function QuestionAutoDismissToggle({
  deadline,
  accessibilityLabel,
  children,
  ...props
}: Omit<PressableProps, "children" | "accessibilityLabel"> & {
  readonly deadline: string | null;
  readonly accessibilityLabel: string;
  readonly children: (timer: ReactNode) => ReactNode;
}) {
  const countdown = useUserInputCountdown(deadline);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        countdown ? `${accessibilityLabel}, ${countdown.label}` : accessibilityLabel
      }
      {...props}
    >
      {children(
        countdown ? (
          <Text
            className={cn(
              "shrink font-sans text-xs tabular-nums text-foreground-secondary",
              countdown.state !== "counting" && "text-warning-foreground",
            )}
          >
            {countdown.text}
          </Text>
        ) : null,
      )}
    </Pressable>
  );
}
