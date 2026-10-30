import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";

import { environmentPresentations } from "../state/presentation";
import { environmentServerConfigsAtom } from "../state/server";
import { environmentShell } from "../state/shell";
import { useThreadOutbox, webThreadOutbox } from "../state/threadOutbox";
import { subscribeThreadOutboxStorage } from "../state/threadOutboxStorage";

const outboxReadyAtom = Atom.make((get) => {
  const presentations = get(environmentPresentations.presentationsAtom);
  const configs = get(environmentServerConfigsAtom);
  const shells = [...presentations.keys()].map((environmentId) =>
    get(environmentShell.stateValueAtom(environmentId)),
  );
  return { presentations, configs, shells };
});

/** Runs outside the router so pending messages continue after leaving their thread. */
export function ThreadOutboxCoordinator() {
  const ready = useAtomValue(outboxReadyAtom);
  const entries = useThreadOutbox();
  useEffect(() => {
    void webThreadOutbox.load().catch(console.error);
    return subscribeThreadOutboxStorage(() => {
      void webThreadOutbox.reload().catch(console.error);
    });
  }, []);
  useEffect(() => {
    if (!ready || entries.length === 0) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const drain = () => {
      void webThreadOutbox
        .drain()
        .then((next) => {
          if (!stopped && next !== null) timer = setTimeout(drain, Math.max(0, next - Date.now()));
        })
        .catch((error: unknown) => {
          console.error("[thread-outbox] Delivery could not complete", error);
          if (!stopped) timer = setTimeout(drain, 1_000);
        });
    };
    drain();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [ready, entries]);
  return null;
}
