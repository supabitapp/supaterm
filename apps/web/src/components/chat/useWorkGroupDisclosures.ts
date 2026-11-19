import { useEffect, useRef, useState } from "react";
import {
  WORK_GROUP_CLOSE_MS,
  WORK_GROUP_OPEN_MS,
  type WorkGroupDisclosures,
  type WorkGroupTransition,
  restoredWorkGroupDisclosures,
  settleWorkGroupTransition,
  startWorkGroupTransition,
} from "./workGroupDisclosure";

/**
 * One list's tool group disclosures. Groups remembered as expanded come back
 * open without animating. A transition settles once it has played, unless a
 * later one for the same group replaced it.
 */
export function useWorkGroupDisclosures(
  identity: string,
  rememberedExpandedIds: ReadonlySet<string> | undefined,
): readonly [WorkGroupDisclosures, (groupId: string, transition: WorkGroupTransition) => void] {
  const [state, setState] = useState(() => ({
    identity,
    disclosures: restoredWorkGroupDisclosures(rememberedExpandedIds),
  }));
  let current = state;
  if (state.identity !== identity) {
    current = { identity, disclosures: restoredWorkGroupDisclosures(rememberedExpandedIds) };
    setState(current);
  }

  const timersRef = useRef(new Map<string, number>());
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- clears the pending transition timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const beginTransition = (groupId: string, transition: WorkGroupTransition) => {
    setState((latest) => ({
      ...latest,
      disclosures: startWorkGroupTransition(latest.disclosures, groupId, transition),
    }));
    const timers = timersRef.current;
    window.clearTimeout(timers.get(groupId));
    timers.set(
      groupId,
      window.setTimeout(
        () => {
          timers.delete(groupId);
          setState((latest) => {
            if (latest.identity !== identity) return latest;
            const disclosures = settleWorkGroupTransition(latest.disclosures, groupId, transition);
            return disclosures === latest.disclosures ? latest : { ...latest, disclosures };
          });
        },
        transition === "closing" ? WORK_GROUP_CLOSE_MS : WORK_GROUP_OPEN_MS,
      ),
    );
  };

  return [current.disclosures, beginTransition];
}
