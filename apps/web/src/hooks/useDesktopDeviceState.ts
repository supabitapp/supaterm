import { useEffect, useState } from "react";

interface DesktopDeviceStateSource<State> {
  readonly getState: () => Promise<State>;
  readonly onStateChange: (listener: (state: State) => void) => () => void;
}

/** A desktop device's pushed state, seeded by one read that never overwrites a newer push. */
export function useDesktopDeviceState<State>(
  source: DesktopDeviceStateSource<State> | null,
): State | null {
  const [state, setState] = useState<State | null>(null);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- subscribes to a desktop bridge's device state and reads its current state once
  useEffect(() => {
    if (source === null) return;
    let current = true;
    let pushed = false;
    const unsubscribe = source.onStateChange((next) => {
      pushed = true;
      if (current) setState(next);
    });
    void source.getState().then(
      (next) => {
        if (current && !pushed) setState(next);
      },
      () => undefined,
    );
    return () => {
      current = false;
      unsubscribe();
    };
  }, [source]);
  return state;
}
