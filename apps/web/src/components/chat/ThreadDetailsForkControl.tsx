import type { RunId, ThreadId } from "@supaterm/contracts";
import { GitForkIcon } from "@supaterm/icons";
import { useState } from "react";

import { useShortcutLabel } from "../../hooks/useShortcutLabel";
import { Kbd } from "../ui/kbd";
import { ThreadDetailsControl } from "./ThreadDetailsControl";
import { THREAD_DETAILS_PANEL_ICON_CLASS } from "./threadDetailsPanelStyles";

export function ThreadDetailsForkControl(props: {
  source: { readonly sourceThreadId: ThreadId; readonly runId: RunId };
  disabled: boolean;
  onForkFromRun: (input: {
    readonly sourceThreadId: ThreadId;
    readonly runId: RunId;
  }) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const shortcut = useShortcutLabel("thread.fork");

  return (
    <ThreadDetailsControl
      className="group/fork-thread"
      disabled={props.disabled || busy}
      onClick={() => {
        setBusy(true);
        void props.onForkFromRun(props.source).finally(() => setBusy(false));
      }}
    >
      <GitForkIcon aria-hidden className={THREAD_DETAILS_PANEL_ICON_CLASS} />
      <span className="min-w-0 truncate">{busy ? "Forking thread…" : "Fork thread"}</span>
      {shortcut ? (
        <span className="ms-auto shrink-0 opacity-0 transition-opacity duration-150 ease-out group-hover/fork-thread:opacity-100 group-focus-visible/fork-thread:opacity-100 motion-reduce:transition-none">
          <Kbd variant="plain" aria-hidden>
            {shortcut}
          </Kbd>
        </span>
      ) : null}
    </ThreadDetailsControl>
  );
}
