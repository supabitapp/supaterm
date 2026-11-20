import { isLinkedThreadWorking, linkedThreadFailure } from "@supaterm/client-runtime/linked-thread";
import type { ScopedThreadRef } from "@supaterm/contracts";
import { EyeIcon, PlugIcon } from "@supaterm/icons";
import { useState, type ReactNode } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { type LinkedThreadSurface, linkedThreadTitle } from "../../linkedThreadSurface";
import { useEnvironment } from "../../state/environments";
import {
  linkedThreadItemSource,
  useConnectLinkedEnvironment,
  useLinkedThreadView,
} from "../../state/linkedThreadView";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { ComposerSurface } from "./ComposerSurface";
import type { MessagesTimelineHistoryControls } from "./MessagesTimeline";
import {
  ReadOnlyComposerBar,
  ReadOnlyComposerLead,
  ReadOnlyComposerStatus,
} from "./ReadOnlyComposerBar";
import { ReadOnlyThreadTimeline } from "./ReadOnlyThreadTimeline";
import { toastManager } from "../ui/toast";

/**
 * Stands where a composer would: the thread takes no messages from here. `action` is the one way
 * forward it offers, and `notice` what came of it.
 */
function LinkedThreadComposer(props: {
  /** The linked environment the thread is on. */
  readonly label: string;
  /** The environment that reads it. */
  readonly via: string;
  readonly working: boolean;
  readonly action?: ReactNode;
  readonly notice?: ReactNode;
}) {
  const { label, via } = props;
  return (
    <div className="flex shrink-0 flex-col gap-1 px-3 pb-3">
      {props.notice}
      <ComposerSurface.Shell>
        <ComposerSurface.Host>
          <div className="relative z-10">
            <ReadOnlyComposerBar actions={props.action}>
              <ReadOnlyComposerLead>
                <EyeIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-medium text-foreground">Read-only</span>
              </ReadOnlyComposerLead>
              <ReadOnlyComposerStatus role="status">
                {props.working ? `On ${label} via ${via} · Working` : `On ${label} via ${via}`}
              </ReadOnlyComposerStatus>
            </ReadOnlyComposerBar>
          </div>
        </ComposerSurface.Host>
      </ComposerSurface.Shell>
    </div>
  );
}

const ignore = () => {};

/**
 * A linked environment's thread, streamed through the environment this client is connected to
 * and drawn by the timeline every thread uses. The client never connects to the linked one, so
 * the view only reads: what would need that connection is absent. Key it by its surface id.
 */
export function LinkedThreadPane(props: {
  /** The thread whose panel shows the tab. */
  readonly panelRef: ScopedThreadRef;
  readonly surface: LinkedThreadSurface;
  /** Whether the tab is showing; the stream runs only while it is. */
  readonly visible: boolean;
}) {
  const { surface, panelRef } = props;
  const via = useEnvironment(surface.viaEnvironmentId)?.label ?? "this environment";
  const { view, error, retry } = useLinkedThreadView(panelRef, surface, props.visible);
  const [turnItemSource] = useState(() => linkedThreadItemSource(surface));
  const label = surface.label;
  const projection = view?.thread.projection ?? null;
  const connection = useConnectLinkedEnvironment(panelRef, surface);
  const connectState = connection.state;
  const connecting = connectState.phase === "connecting";
  const connect = async () => {
    const outcome = await connection.connect();
    if (outcome.type === "connected") {
      toastManager.add({
        type: "success",
        title: `Connected to ${label}`,
        description: "This device is paired with it and can use its threads.",
      });
    }
  };
  const connectNotice =
    connectState.phase === "connecting" ? (
      <Alert variant="info">
        <PlugIcon />
        <AlertTitle>Connecting to {label}…</AlertTitle>
      </Alert>
    ) : connectState.phase === "unreachable" ? (
      <Alert variant="warning">
        <PlugIcon />
        <AlertTitle>{connectState.label} is not reachable from this device</AlertTitle>
        <AlertDescription>
          Join a network it is on, such as its Tailscale network, and try again. You can keep
          reading here.
        </AlertDescription>
      </Alert>
    ) : connectState.phase === "manual" ? (
      <Alert variant="info">
        <PlugIcon />
        <AlertTitle>{connectState.prefill.label} needs a pairing code</AlertTitle>
        <AlertDescription>
          Create one on it, then add it to this device as an environment.
        </AlertDescription>
        <AlertAction>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => connection.addWithCode(connectState.prefill)}
          >
            Enter code
          </Button>
        </AlertAction>
      </Alert>
    ) : null;
  const connectAction = (
    <Button size="sm" variant="outline" disabled={connecting} onClick={() => void connect()}>
      <PlugIcon aria-hidden />
      <span className="@max-[320px]/composer-surface:sr-only">Connect to interact</span>
    </Button>
  );
  const failure = error === null ? null : linkedThreadFailure(error, { via, label });
  const retryAction = failure?.retryable ? (
    <AlertAction>
      <Button size="sm" variant="outline" onClick={retry}>
        Try again
      </Button>
    </AlertAction>
  ) : null;
  // A file or visual lives on the linked environment, which this client has no way to ask.
  const renderHtmlRender = useStableCallback(() => (
    <p className="chat-content-lane text-xs text-muted-foreground">
      Open this thread on {label} to see this visual.
    </p>
  ));
  const working = projection !== null && isLinkedThreadWorking(projection);
  const historyControls: MessagesTimelineHistoryControls | undefined =
    view === null || view.thread.historyCursor === null
      ? undefined
      : {
          historyCursor: view.thread.historyCursor,
          hasMoreHistory: true,
          loading: view.history.loading,
          error: view.history.failed ? "Could not load earlier turns. Try again." : null,
          onLoadEarlier: view.loadEarlier,
        };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <h2 className="shrink-0 truncate border-b border-border px-3 py-2 text-sm font-medium">
        {linkedThreadTitle(
          { title: projection?.thread.title || surface.title },
          `Thread on ${label}`,
        )}
      </h2>
      {projection === null ? (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {failure === null ? (
              <p className="text-sm text-muted-foreground">Reading from {label}…</p>
            ) : (
              <Alert variant="error">
                <AlertTitle>{failure.title}</AlertTitle>
                <AlertDescription>{failure.detail}</AlertDescription>
                {retryAction}
              </Alert>
            )}
          </div>
          <LinkedThreadComposer
            label={label}
            via={via}
            working={false}
            notice={connectNotice}
            action={connectAction}
          />
        </>
      ) : (
        <ReadOnlyThreadTimeline
          // No ":" so the timeline finds no environment thread behind the key.
          threadKey={`linked-${encodeURIComponent(surface.id)}`}
          projection={projection}
          historyControls={historyControls}
          turnItemSource={turnItemSource}
          onImageExpand={ignore}
          renderHtmlRender={renderHtmlRender}
        >
          {failure === null ? null : (
            <div className="shrink-0 px-3 pb-2">
              <Alert variant="warning">
                <AlertTitle>{failure.title}</AlertTitle>
                <AlertDescription>{failure.detail} Showing what was read before.</AlertDescription>
                {retryAction}
              </Alert>
            </div>
          )}
          <LinkedThreadComposer
            label={label}
            via={via}
            working={working}
            notice={connectNotice}
            action={connectAction}
          />
        </ReadOnlyThreadTimeline>
      )}
    </div>
  );
}
