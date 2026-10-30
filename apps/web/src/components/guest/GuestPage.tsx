import {
  EnvironmentId,
  GUEST_MESSAGE_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  GUEST_ROUTE_PREFIX,
  GUEST_SHARE_PARAM,
  GuestMessageId,
  GuestLinkPayload,
  type GuestRedeemRequest,
  type GuestShareView,
  type GuestThreadModel,
  type OrchestrationV2ThreadProjection,
  type ThreadGuestMessage,
  type ThreadGuestMessageStatus,
} from "@supaterm/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { formatAttachmentSize } from "@supaterm/client-runtime/state/attachments";
import {
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveThreadStructureRuntime,
} from "@supaterm/client-runtime/state/thread-execution";
import { createQuestionHistoryProjector } from "@supaterm/client-runtime/state/thread-requests";
import { ArrowUpIcon, PaperclipIcon, XIcon } from "@supaterm/icons";
import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import { useIncrementalTimelineEntries } from "~/hooks/useIncrementalTimelineEntries";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useTheme } from "~/hooks/useTheme";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";
import { deriveActiveWorkStartedAt, derivePhase } from "~/session-logic";
import { ComposerControl, ComposerControlIcon } from "../chat/ComposerControl";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { GuestMessageAttachments } from "../chat/GuestMessageAttachments";
import { HostImageUrlContext } from "../chat/hostImageUrl";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import { GuestMessageName, guestBubbleClassName } from "../chat/guestMessageStyle";
import { MessagesTimeline } from "../chat/MessagesTimeline";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getDisplayModelName, getTriggerDisplayModelName } from "../chat/providerIconUtils";
import { ScrollToEndButton } from "../chat/TimelineOverlays";
import type { TimelineRow } from "../chat/timelineRowContext";
import { useTimelineFollow } from "../chat/useTimelineFollow";
import { GuestHtmlRender } from "./GuestHtmlRender";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  applyGuestStreamEvent,
  formatGuestExpiry,
  guestAttachmentUrl,
  guestMediaUrl,
  createGuestAttachmentUrls,
  guestFilesProblem,
  initialGuestStreamState,
  inviteShareId,
  type GuestStreamState,
  parseGuestStreamEvent,
  unplacedGuestMessages,
} from "./guestStream.logic";
import { decodeBase64, parseRelayAddress } from "@supaterm/shared/relay/protocol";
import { chatMarkdownImageSources } from "@supaterm/shared/markdownPipeline";
import { markdownDestinationHostPath } from "@supaterm/shared/markdownLinks";
import { createGuestTransport, type GuestTransport } from "./guestTransport";
import { GuestTransportContext, useGuestTransport } from "./GuestTransportContext";
import { openGuestEvents } from "./guestEvents";
import { useGuestAssets } from "./useGuestAssets";
import { guestTurnItemSource } from "./guestTurnItemSource";

interface GuestEntry {
  readonly link: GuestLinkPayload | null;
  readonly transport: GuestTransport | null;
  readonly shareId: string | null;
}

const AWAITING_ROWS_KEY = "supaterm:guest-awaiting-rows";
const AWAITING_ROWS_LIMIT = 50;
function readAwaitingRowIds(): ReadonlySet<GuestMessageId> {
  try {
    const stored = decodeAwaitingRows(
      JSON.parse(sessionStorage.getItem(AWAITING_ROWS_KEY) ?? "[]"),
    );
    return new Set(stored.map((id) => GuestMessageId.make(id)));
  } catch {
    return new Set();
  }
}
function writeAwaitingRowIds(ids: ReadonlySet<GuestMessageId>) {
  try {
    sessionStorage.setItem(AWAITING_ROWS_KEY, JSON.stringify([...ids].slice(-AWAITING_ROWS_LIMIT)));
  } catch {}
}
const decodeAwaitingRows = Schema.decodeUnknownSync(Schema.Array(Schema.String));
const decodeGuestLink = Schema.decodeUnknownSync(GuestLinkPayload);
const decodeGuestToken = Schema.decodeUnknownSync(Schema.Struct({ token: Schema.String }));
const guestSessionKey = (address: string, shareId: string) =>
  `supaterm:guest:${address}:${shareId}`;
function takeGuestEntry(): GuestEntry {
  try {
    const hash = window.location.hash.slice(1);
    const storageKey = `supaterm:guest-link:${window.location.search}`;
    const encoded = hash || sessionStorage.getItem(storageKey);
    if (!encoded) return { link: null, transport: null, shareId: null };
    const link = decodeGuestLink(JSON.parse(new TextDecoder().decode(decodeBase64(encoded))));
    if (!parseRelayAddress(link.address)) throw new Error("Invalid guest link.");
    const shareId = inviteShareId(link.credential);
    if (!shareId) throw new Error("Invalid guest link.");
    const query = `?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}`;
    sessionStorage.setItem(`supaterm:guest-link:${query}`, encoded);
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${query}`);
    const token = sessionStorage.getItem(guestSessionKey(link.address, shareId));
    const connection = createGuestTransport(link, token);
    const transport: GuestTransport = {
      ...connection,
      setToken(next) {
        connection.setToken(next);
        sessionStorage.setItem(guestSessionKey(link.address, shareId), next);
      },
    };
    return { link, shareId, transport };
  } catch {
    return { link: null, transport: null, shareId: null };
  }
}

const decodeErrorBody = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

async function postGuest(
  transport: GuestTransport,
  path: "redeem" | `messages?${string}`,
  body: typeof GuestRedeemRequest.Encoded | FormData,
): Promise<string | null> {
  try {
    const response = await transport.request(
      `${GUEST_ROUTE_PREFIX}/${path}`,
      body instanceof FormData
        ? { method: "POST", body }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    if (response.ok) {
      if (path === "redeem") {
        const { token } = decodeGuestToken(await response.json());
        transport.setToken(token);
      }
      return null;
    }
    const json: unknown = await response.json().catch(() => null);
    return Option.match(decodeErrorBody(json), {
      onNone: () => "Something went wrong. Try again.",
      onSome: ({ message }) => message,
    });
  } catch {
    return "Could not reach the server.";
  }
}

const STATUS_LABEL: Record<ThreadGuestMessageStatus, string> = {
  pending: "Waiting for approval",
  sent: "Sent",
  dismissed: "Not sent",
};

const LANE = "chat-content-lane px-4";

type GuestAccess = "checking" | "session" | "name" | "none";

export function GuestPage() {
  const [{ link, shareId, transport }] = useState(takeGuestEntry);
  const credential = link?.credential ?? null;
  const lifetime = useRef(0);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- closes the guest-only tunnel after unmount while allowing StrictMode to reattach effects
  useEffect(() => {
    const version = ++lifetime.current;
    return () =>
      queueMicrotask(() => {
        if (lifetime.current === version) transport?.close();
      });
  }, [transport]);
  const [access, setAccess] = useState<GuestAccess>(shareId === null ? "none" : "checking");
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- fetches whether this browser already has a guest session and ignores the answer after cleanup
  useEffect(() => {
    if (shareId === null || transport === null) return;
    let live = true;
    void transport
      .request(`${GUEST_ROUTE_PREFIX}/session?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}`)
      .then(
        (response): GuestAccess =>
          response.ok ? "session" : credential !== null ? "name" : "none",
        (): GuestAccess => (credential !== null ? "name" : "session"),
      )
      .then((next) => {
        if (live) setAccess(next);
      });
    return () => {
      live = false;
    };
  }, [credential, shareId, transport]);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- hashchange listener reloads the page when another guest link is pasted into this tab
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash !== "") window.location.reload();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <GuestTransportContext value={transport}>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        {access === "checking" ? (
          <Notice title="Connecting..." />
        ) : access === "name" && credential !== null ? (
          <NameForm
            credential={credential}
            onJoined={() => {
              setAccess("session");
            }}
          />
        ) : access === "session" && shareId !== null ? (
          <GuestSession shareId={shareId} />
        ) : (
          <Notice
            title="This link has ended or is not valid"
            detail="Ask the owner for a new link. Each link works in one browser."
          />
        )}
      </div>
    </GuestTransportContext>
  );
}

function GuestSession({ shareId }: { readonly shareId: string }) {
  const transport = useGuestTransport();
  const [stream, dispatch] = useReducer(applyGuestStreamEvent, null, () => ({
    ...initialGuestStreamState,
    awaitingRowIds: readAwaitingRowIds(),
  }));
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- persists the awaiting row ids to sessionStorage so a reload keeps them
  useEffect(() => writeAwaitingRowIds(stream.awaitingRowIds), [stream.awaitingRowIds]);
  const [rejected, setRejected] = useState(false);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- sets document.title to the shared thread's title
  useEffect(() => {
    if (stream.view) document.title = stream.view.title;
  }, [stream.view]);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- opens the guest EventSource stream and closes it on cleanup
  useEffect(() => {
    const source = openGuestEvents(
      transport,
      `${GUEST_ROUTE_PREFIX}/stream?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}`,
      (data) => {
        const event = parseGuestStreamEvent(data);
        if (event === null) return;
        dispatch(event);
        if (event.type === "ended") source.close();
      },
      () => setRejected(true),
    );
    return () => source.close();
  }, [shareId, transport]);

  if (stream.ended || (rejected && stream.view !== null)) {
    return <Notice title="This link has ended" detail="The owner stopped sharing this thread." />;
  }
  if (stream.view !== null) {
    if (stream.projection === null) return <Notice title="Connecting..." />;
    return (
      <GuestThread
        view={stream.view}
        projection={stream.projection}
        awaitingRowIds={stream.awaitingRowIds}
      />
    );
  }
  if (!rejected) return <Notice title="Connecting..." />;
  return (
    <Notice
      title="This link has ended or is not valid"
      detail="Ask the owner for a new link. Each link works in one browser."
    />
  );
}

function Notice({ title, detail }: { readonly title: string; readonly detail?: string }) {
  return (
    <div className="m-auto flex max-w-sm flex-col gap-1 p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function NameForm({
  credential,
  onJoined,
}: {
  readonly credential: string;
  readonly onJoined: () => void;
}) {
  const transport = useGuestTransport();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || submitting) return;
    setSubmitting(true);
    const failure = await postGuest(transport, "redeem", { credential, name: trimmed });
    setSubmitting(false);
    if (failure === null) onJoined();
    else setError(failure);
  };
  return (
    <form className="m-auto flex w-full max-w-xs flex-col gap-3 p-6" onSubmit={submit}>
      <h1 className="text-base font-medium">Join a shared thread</h1>
      <label className="flex flex-col gap-1.5 text-sm" htmlFor="guest-name">
        Your name
        <Input
          id="guest-name"
          autoFocus
          autoComplete="name"
          maxLength={GUEST_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={submitting || name.trim() === ""}>
        Join
      </Button>
      <p className="text-xs text-muted-foreground">
        The owner sees your name and approves each message before the agent gets it.
      </p>
    </form>
  );
}
const GUEST_ENVIRONMENT_ID = EnvironmentId.make("guest");
const NO_TURN_DIFFS: ReadonlyArray<never> = [];
const NO_OPTIMISTIC_MESSAGES: ReadonlyArray<never> = [];
const ignore = () => {};

function GuestThread({
  view: { shareId, title, expiresAt, messages, model },
  projection,
  awaitingRowIds,
}: {
  readonly view: GuestShareView;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly awaitingRowIds: GuestStreamState["awaitingRowIds"];
}) {
  const transport = useGuestTransport();
  const threadKey = `guest-${shareId}`;
  const listRef = useRef<LegendListRef | null>(null);
  const { resolvedTheme } = useTheme();
  const [projectQuestionHistory] = useState(() => createQuestionHistoryProjector());
  const items = projectQuestionHistory(projection);
  const [attachmentUrls] = useState(() => createGuestAttachmentUrls(shareId));
  const [turnItemSource] = useState(() => guestTurnItemSource(shareId, transport));
  const attachmentPaths = attachmentUrls(items);
  const imagePaths = items.flatMap(({ item }) =>
    item.type === "assistant_message"
      ? chatMarkdownImageSources(item.text).flatMap((source) => {
          const path = markdownDestinationHostPath(source);
          return path === null ? [] : [guestMediaUrl(shareId, path)];
        })
      : [],
  );
  const waitingPaths = messages.flatMap((message) =>
    message.status === "dismissed"
      ? []
      : (message.attachments ?? []).map((attachment) => guestAttachmentUrl(shareId, attachment.id)),
  );
  const assets = useGuestAssets([...attachmentPaths.values(), ...imagePaths, ...waitingPaths]);
  const attachmentUrlById = new Map(
    [...attachmentPaths].flatMap(([id, path]) => {
      const url = assets.get(path);
      return url ? [[id, url] as const] : [];
    }),
  );
  const entries = useIncrementalTimelineEntries(threadKey, {
    visibleTurnItems: items,
    optimisticMessages: NO_OPTIMISTIC_MESSAGES,
    attachmentUrlById,
    attempts: projection.attempts,
    nodes: projection.nodes,
    plans: projection.plans,
  });
  const openFile = useStableCallback((file: { readonly id: string }) =>
    openGuestFile(transport, guestAttachmentUrl(shareId, file.id)),
  );
  const hostImageUrl = useStableCallback(
    (path: string) => assets.get(guestMediaUrl(shareId, path)) ?? "",
  );
  const activityRun = deriveThreadActivityRun(projection);
  const runtime = deriveThreadStructureRuntime(projection);
  const runlessWorkStartedAt = deriveRunlessWorkStartedAt(projection);
  const isWorking = derivePhase(runtime) === "running" || runlessWorkStartedAt !== null;
  const workStartedAt =
    deriveActiveWorkStartedAt(activityRun, runtime, null) ?? runlessWorkStartedAt;
  const runningRunId = runtime?.activeRunId ?? null;
  const follow = useTimelineFollow({
    legendListRef: listRef,
    composerTimelineInset: 0,
    routeThreadKey: threadKey,
    activeThreadKey: threadKey,
    isServerThread: false,
    serverProjection: null,
    threadStatus: "live",
    activeActivityRun: activityRun,
    activeRunningTurnId: runningRunId,
    timelineEntries: entries,
    timelineAnchorMessageId: null,
    setTimelineAnchor: ignore,
  });
  const renderHtmlRender = useStableCallback(
    (row: Extract<TimelineRow, { kind: "html-render" }>) => (
      <GuestHtmlRender itemId={row.id} reference={row.htmlRender} shareId={shareId} />
    ),
  );
  const unplaced = unplacedGuestMessages(messages, items, awaitingRowIds);
  const unplacedKey = unplaced.map((message) => message.id).join(",");
  const previousUnplacedKey = useRef(unplacedKey);
  const following = useRef(follow.timelineLiveFollowEnabled);
  const scrollToEnd = useStableCallback(follow.scrollToEnd);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- scrolls the timeline to the end after commit when new unplaced messages appear
  useEffect(() => {
    following.current = follow.timelineLiveFollowEnabled;
    const previous = new Set(previousUnplacedKey.current.split(","));
    previousUnplacedKey.current = unplacedKey;
    if (unplacedKey.split(",").some((id) => id !== "" && !previous.has(id))) scrollToEnd(true);
  }, [follow.timelineLiveFollowEnabled, unplacedKey, scrollToEnd, following, previousUnplacedKey]);
  const footerRef = useRef<HTMLOListElement>(null);
  const hasFooter = unplaced.length > 0;
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- ResizeObserver on the footer keeps it scrolled into view while following
  useEffect(() => {
    const footer = footerRef.current;
    if (!hasFooter || footer === null) return;
    return observeResize(footer, () => {
      if (following.current) scrollToEnd();
    });
  }, [hasFooter, scrollToEnd, following]);
  return (
    <>
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
        <ExpiryLabel expiresAt={expiresAt} />
      </header>
      <div className="relative min-h-0 flex-1">
        <HostImageUrlContext value={hostImageUrl}>
          <MessagesTimeline
            listRef={listRef}
            timelineEntries={entries}
            isWorking={isWorking}
            activeTurnStartedAt={workStartedAt}
            latestRun={activityRun}
            runningRunId={runningRunId}
            turnDiffSummaries={NO_TURN_DIFFS}
            runs={projection.runs}
            routeThreadKey={threadKey}
            onOpenThread={ignore}
            supportsConversationRollback={false}
            onRevertToTurnCount={ignore}
            isRevertingCheckpoint={false}
            onImageExpand={openExpandedImage}
            onFileOpen={openFile}
            onFileDownload={openFile}
            renderHtmlRender={renderHtmlRender}
            turnItemSource={turnItemSource}
            activeThreadEnvironmentId={GUEST_ENVIRONMENT_ID}
            markdownCwd={undefined}
            resolvedTheme={resolvedTheme}
            timestampFormat="locale"
            workspaceRoot={undefined}
            anchorMessageId={null}
            onAnchorReady={ignore}
            onAnchorSizeChanged={ignore}
            contentInsetEndAdjustment={0}
            emptyPlaceholderInset={0}
            liveFollowEnabled={follow.timelineLiveFollowEnabled}
            onIsAtEndChange={follow.onIsAtEndChangeStable}
            onViewportAttach={follow.attachTimelineViewport}
            footer={
              unplaced.length === 0 ? null : (
                <ol ref={footerRef} className="chat-content-lane flex flex-col gap-4 pb-4">
                  {unplaced.map((message) => (
                    <li key={message.id}>
                      <UnplacedGuestMessage shareId={shareId} message={message} assets={assets} />
                    </li>
                  ))}
                </ol>
              )
            }
          />
        </HostImageUrlContext>
        {follow.showScrollToBottom ? (
          <ScrollToEndButton
            summary={null}
            bottom={4}
            onScrollToEnd={() => follow.scrollToEnd(true)}
          />
        ) : null}
      </div>
      <div className={cn(LANE, "shrink-0 pb-4")}>
        <GuestComposer shareId={shareId} model={model} />
      </div>
    </>
  );
}

function ExpiryLabel({ expiresAt }: { readonly expiresAt: string }) {
  const nowMinute = useNowMinute();
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {formatGuestExpiry(expiresAt, Date.parse(`${nowMinute}Z`))}
    </span>
  );
}

const BUBBLE =
  "flex min-w-0 max-w-[80%] flex-col gap-2 rounded-2xl p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]";

const openInNewTab = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
async function openGuestFile(transport: GuestTransport, path: string) {
  const opened = window.open("", "_blank");
  if (opened) opened.opener = null;
  try {
    const response = await transport.request(path);
    if (!response.ok) throw new Error("Guest file unavailable.");
    const url = URL.createObjectURL(await response.blob());
    if (opened) opened.location.replace(url);
    else URL.revokeObjectURL(url);
  } catch {
    opened?.close();
  }
}
const openExpandedImage = (preview: ExpandedImagePreview) => {
  const src = preview.images[preview.index]?.src;
  if (src) openInNewTab(src);
};

function UnplacedGuestMessage({
  shareId,
  message,
  assets,
}: {
  readonly assets: ReadonlyMap<string, string>;
  readonly shareId: GuestShareView["shareId"];
  readonly message: ThreadGuestMessage;
}) {
  const served = message.status !== "dismissed";
  const url = (attachment: { readonly id: string }) =>
    assets.get(guestAttachmentUrl(shareId, attachment.id));
  return (
    <div className="flex flex-col items-end gap-1">
      <GuestMessageName name="You" />
      <div
        className={cn(
          BUBBLE,
          guestBubbleClassName(message.status !== "sent"),
          message.status === "dismissed" ? "text-muted-foreground" : "text-message-foreground",
        )}
      >
        <GuestMessageAttachments
          attachments={message.attachments ?? []}
          imageUrl={(attachment) => (served ? url(attachment) : undefined)}
          onOpenImage={(attachment) => {
            const target = url(attachment);
            if (target) openInNewTab(target);
          }}
          {...(served ? { fileHref: url } : {})}
        />
        {message.text ? <span>{message.text}</span> : null}
      </div>
      <p className="me-1 text-2xs text-muted-foreground">{STATUS_LABEL[message.status]}</p>
    </div>
  );
}

function GuestModelLabel({ model }: { readonly model: GuestThreadModel }) {
  const label = getTriggerDisplayModelName({ slug: model.name, ...model }, model.driver);
  const fullLabel = getDisplayModelName({ slug: model.name, ...model });
  return (
    <ComposerControl
      render={<span />}
      aria-label={`Model: ${fullLabel}`}
      className="pointer-events-none min-w-0 shrink"
    >
      {model.driver === null ? null : (
        <ProviderInstanceIcon
          driverKind={model.driver}
          displayName={label}
          className="size-4"
          iconClassName="size-4"
        />
      )}
      <span className="min-w-0 truncate" data-chat-provider-model-picker-label="true">
        {label}
      </span>
    </ComposerControl>
  );
}

interface StagedFile {
  readonly key: string;
  readonly file: File;
}

function StagedImage({ file }: { readonly file: File }) {
  return (
    <img
      alt={file.name}
      className="size-full object-cover"
      ref={(image) => {
        if (!image) return;
        const url = URL.createObjectURL(file);
        image.src = url;
        return () => URL.revokeObjectURL(url);
      }}
    />
  );
}

function GuestComposer({
  shareId,
  model,
}: {
  readonly shareId: GuestShareView["shareId"];
  readonly model: GuestThreadModel;
}) {
  const transport = useGuestTransport();
  const [text, setText] = useState("");
  const [files, setFiles] = useState<ReadonlyArray<StagedFile>>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextFileKey = useRef(0);
  const { resolvedTheme } = useTheme();
  const addFiles = (added: ReadonlyArray<File>) => {
    if (added.length === 0) return;
    const next = [
      ...files,
      ...added.map((file) => ({ key: `staged-${nextFileKey.current++}`, file })),
    ];
    const problem = guestFilesProblem(next.map((staged) => staged.file));
    setError(problem);
    if (problem === null) setFiles(next);
  };
  const send = async () => {
    const trimmed = text.trim();
    if ((trimmed === "" && files.length === 0) || sending) return;
    setSending(true);
    const sentFiles = files;
    const form = new FormData();
    form.append("shareId", shareId);
    form.append("text", trimmed);
    for (const staged of sentFiles) form.append("file", staged.file, staged.file.name);
    const failure = await postGuest(
      transport,
      `messages?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}`,
      form,
    );
    setSending(false);
    setError(failure);
    if (failure === null) {
      setText((current) => (current.trim() === trimmed ? "" : current));
      setFiles((current) => current.filter((staged) => !sentFiles.includes(staged)));
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData.files);
    const hasImage = pasted.some((file) => file.type.startsWith("image/"));
    if (pasted.length === 0 || (!hasImage && event.clipboardData.getData("text/plain") !== "")) {
      return;
    }
    event.preventDefault();
    addFiles(pasted);
  };
  return (
    <form
      className="flex flex-col gap-2 rounded-3xl border border-border bg-card px-4 pt-3 pb-2.5 shadow-composer dark:shadow-composer-dark"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Attached files">
          {files.map((staged) => (
            <li
              key={staged.key}
              className="flex h-14 min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-border/80 bg-background/70 pe-1"
            >
              {staged.file.type.startsWith("image/") ? (
                <span className="size-14 shrink-0">
                  <StagedImage file={staged.file} />
                </span>
              ) : (
                <span className="flex min-w-0 items-center gap-2 ps-2 text-sm">
                  <PierreEntryIcon pathValue={staged.file.name} kind="file" theme={resolvedTheme} />
                  <span className="max-w-40 truncate">{staged.file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatAttachmentSize(staged.file.size)}
                  </span>
                </span>
              )}
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Remove ${staged.file.name}`}
                onClick={() => {
                  setError(null);
                  setFiles((current) => current.filter((candidate) => candidate !== staged));
                }}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        aria-label="Message"
        placeholder="Message"
        rows={2}
        maxLength={GUEST_MESSAGE_MAX_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className="max-h-60 min-h-12 w-full resize-none bg-transparent text-sm outline-none field-sizing-content placeholder:text-placeholder"
      />
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          aria-label="Files to attach"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <ComposerControl aria-label="Attach files" onClick={() => fileInputRef.current?.click()}>
          <ComposerControlIcon icon={PaperclipIcon} />
        </ComposerControl>
        <GuestModelLabel model={model} />
        {error !== null ? (
          <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            The owner approves each message
          </p>
        )}
        <button
          type="submit"
          aria-label="Send"
          disabled={sending || (text.trim() === "" && files.length === 0)}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-message-action text-message-action-foreground shadow-xs hover:bg-message-action-hover focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-64"
        >
          <ArrowUpIcon aria-hidden className="size-4" />
        </button>
      </div>
    </form>
  );
}
