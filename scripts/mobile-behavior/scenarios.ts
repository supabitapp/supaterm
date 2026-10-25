// @effect-diagnostics globalDate:off - scenario windows are wall-clock by nature.

import type { ThreadId } from "@supaterm/contracts";
import type * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  APP_ID,
  SCHEME,
  type AxNode,
  type Device,
  type FeedSample,
  type ProbeState,
} from "./device.ts";
import { uuid, type EvalEnvironment } from "./environment.ts";
import { feedMotion, frameStats, type Metrics } from "./grade.ts";

export type Pose = "phone" | "duo-closed" | "duo-open" | "ipad";

export interface ScenarioContext {
  readonly env: EvalEnvironment;
  readonly device: Device;
  readonly pose: Pose;
  readonly fixtures: { readonly longThread: ThreadId };
}

const threadPath = (ctx: ScenarioContext, threadId: string) =>
  `threads/${encodeURIComponent(ctx.env.environmentId)}/${encodeURIComponent(threadId)}`;

const isThread = (state: ProbeState, threadId: string) =>
  state.route?.name === "Thread" && state.route.params.threadId === threadId;

const openThread = Effect.fn("scenario.openThread")(function* (
  ctx: ScenarioContext,
  threadId: string,
) {
  yield* ctx.device.open(threadPath(ctx, threadId));
  return yield* ctx.device.waitFor(
    `thread ${threadId} with a ready feed`,
    (state) => isThread(state, threadId) && state.feed?.threadId === threadId && state.feed.ready,
    20_000,
  );
});

const geometry = Effect.fn("scenario.geometry")(function* (ctx: ScenarioContext) {
  const nodes = yield* ctx.device.nodes;
  const rect = nodes[0]?.rect ?? { x: 0, y: 0, width: 400, height: 870 };
  const state = yield* ctx.device.state;
  return {
    width: rect.width,
    height: rect.height,
    threadX: Math.round(rect.width * (state.route?.columns ? 0.72 : 0.5)),
  };
});

const findNode = Effect.fn("scenario.findNode")(function* (
  ctx: ScenarioContext,
  description: string,
  match: (node: { label?: string; value?: string; kind?: string; editable?: boolean }) => boolean,
) {
  const node = (yield* ctx.device.nodes).find(match);
  if (!node?.rect) return yield* new ScenarioFailure({ message: `No ${description} on screen.` });
  return node;
});

const composerNode = (ctx: ScenarioContext) =>
  findNode(
    ctx,
    "composer text view",
    (node) => node.kind === "text-view" && node.editable === true,
  );

const composerText = Effect.fn("scenario.composerText")(function* (ctx: ScenarioContext) {
  const node = yield* composerNode(ctx);
  return node.value ?? node.label ?? "";
});

const freshThread = Effect.fn("scenario.freshThread")(function* (
  ctx: ScenarioContext,
  prompt = "Hi. [[eval:reply]]",
) {
  const threadId = yield* ctx.env.launch(`Fresh ${(yield* uuid).slice(0, 6)}`, prompt);
  if (!prompt.includes("[[eval:stream")) yield* ctx.env.settled(threadId);
  return threadId;
});

const typeInComposer = Effect.fn("scenario.typeInComposer")(function* (
  ctx: ScenarioContext,
  text: string,
) {
  const { x, y } = ctx.device.center(yield* composerNode(ctx));
  yield* ctx.device.run(["fill", String(x), String(y), text]);

  yield* ctx.device.waitFor("the keyboard", (state) => state.composer.keyboard, 10_000);
  yield* Effect.sleep("1 second");
});

const countUserText = (
  projection: { readonly messages: ReadonlyArray<{ readonly text?: string }> },
  text: string,
) => projection.messages.filter((message) => message.text === text).length;

const startStream = Effect.fn("scenario.startStream")(function* (
  ctx: ScenarioContext,
  threadId: ThreadId,
  script: string,
) {
  const before = (yield* ctx.device.state).feed?.content ?? 0;
  yield* ctx.env.send(threadId, `Write the long report. ${script}`);
  yield* ctx.device.waitFor(
    "the reply to start streaming in the feed",
    (state) => (state.feed?.content ?? 0) > before + 200,
    20_000,
  );
});

const recordFor = <E, R>(
  ctx: ScenarioContext,
  withFeed: boolean,
  action: Effect.Effect<unknown, E, R>,
) =>
  ctx.device.recordStart(withFeed).pipe(
    Effect.andThen(Effect.exit(action)),
    Effect.flatMap((exit) =>
      ctx.device.recordStop.pipe(Effect.flatMap((recording) => Effect.as(exit, recording))),
    ),
  );

const frameMetrics = (recording: { js: ReadonlyArray<number>; ui: ReadonlyArray<number> }) => {
  const ui = frameStats(recording.ui, "ui");
  const refreshMs = typeof ui.uiRefreshHz === "number" ? 1000 / ui.uiRefreshHz : undefined;
  return { ...frameStats(recording.js, "js", refreshMs), ...ui };
};

export class ScenarioFailure extends Schema.TaggedError<ScenarioFailure>()("ScenarioFailure", {
  message: Schema.String,
}) {}

const failure = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.mapError(
    effect,
    (error) =>
      new ScenarioFailure({ message: error instanceof Error ? error.message : String(error) }),
  );

type Scenario = (ctx: ScenarioContext) => Effect.Effect<Metrics, ScenarioFailure, Crypto.Crypto>;

export const SCENARIOS = {
  scrollUpLongThread: Effect.fn("scenario.scrollUpLongThread")(function* (ctx: ScenarioContext) {
    yield* openThread(ctx, ctx.fixtures.longThread);
    const { height, threadX } = yield* geometry(ctx);
    const recording = yield* recordFor(
      ctx,
      true,
      Effect.gen(function* () {
        for (let fling = 0; fling < 6; fling++)
          yield* ctx.device.swipe(threadX, Math.round(height * 0.35), Math.round(height * 0.8));
        yield* Effect.sleep("1 second");
      }),
    );
    return { ...feedMotion(recording.feed, 1), ...frameMetrics(recording) } satisfies Metrics;
  }, failure),

  streamInView: Effect.fn("scenario.streamInView")(function* (ctx: ScenarioContext) {
    yield* openThread(ctx, ctx.fixtures.longThread);
    yield* startStream(ctx, ctx.fixtures.longThread, "[[eval:stream:4000:25]]");
    const recording = yield* recordFor(ctx, true, Effect.sleep("8 seconds"));
    const after = yield* ctx.device.state;
    yield* ctx.env.interruptAll();
    const motion = feedMotion(recording.feed, 0);
    return {
      ...motion,
      ...frameMetrics(recording),
      settledFromEndPx: settledFromEnd(recording.feed),
      contentGrewPx: (recording.feed.at(-1)?.content ?? 0) - (recording.feed[0]?.content ?? 0),
      followingAtEnd: after.feed?.following === true,
    } satisfies Metrics;
  }, failure),

  sendInLongThread: Effect.fn("scenario.sendInLongThread")(function* (ctx: ScenarioContext) {
    yield* openThread(ctx, ctx.fixtures.longThread);
    const text = `Follow-up ${(yield* uuid).slice(0, 8)} [[eval:reply]]`;
    yield* typeInComposer(ctx, text);
    const recording = yield* recordFor(
      ctx,
      true,
      Effect.gen(function* () {
        yield* ctx.device.press('label="Send"');
        yield* Effect.sleep("4 seconds");
      }),
    );
    const after = yield* ctx.device.state;
    const nativeText = yield* composerText(ctx);
    const projection = yield* ctx.env.settled(ctx.fixtures.longThread);
    const motion = feedMotion(recording.feed, 0);
    return {
      maxFromEndPx: motion.maxFromEndPx ?? null,
      finalFromEndPx: motion.finalFromEndPx ?? null,
      serverMessages: countUserText(projection, text),
      draftCleared: after.composer.draft === "",
      editorCleared: nativeText === "",
    } satisfies Metrics;
  }, failure),

  backgroundFinish: Effect.fn("scenario.backgroundFinish")(function* (ctx: ScenarioContext) {
    const key = `bg-${(yield* uuid).slice(0, 8)}`;
    const other = yield* ctx.env.launch("Background work", `Run the job. [[eval:hold:${key}]]`);
    yield* openThread(ctx, ctx.fixtures.longThread);
    const { height, threadX } = yield* geometry(ctx);
    for (let fling = 0; fling < 2; fling++)
      yield* ctx.device.swipe(threadX, Math.round(height * 0.4), Math.round(height * 0.7));
    yield* waitForStill(ctx);
    const recording = yield* recordFor(
      ctx,
      true,
      Effect.gen(function* () {
        yield* ctx.env.release(key);
        yield* ctx.env.settled(other);
        yield* Effect.sleep("2 seconds");
      }),
    );
    return { ...feedMotion(recording.feed, 0) } satisfies Metrics;
  }, failure),

  draftThreadSwitch: Effect.fn("scenario.draftThreadSwitch")(function* (ctx: ScenarioContext) {
    const text = `Draft ${(yield* uuid).slice(0, 8)}`;
    const other = yield* freshThread(ctx);
    const streaming = yield* freshThread(ctx, "Write the long report. [[eval:stream:4000:25]]");
    yield* openThread(ctx, streaming);
    yield* typeInComposer(ctx, text);
    yield* openThread(ctx, other);
    yield* Effect.sleep("1 second");
    const onOther = yield* ctx.device.state;
    const otherText = yield* composerText(ctx);
    yield* openThread(ctx, streaming);
    yield* Effect.sleep("1 second");
    const back = yield* ctx.device.state;
    const backText = yield* composerText(ctx);
    yield* ctx.env.interruptAll();
    const otherKey = `${ctx.env.environmentId}:${other}`;
    return {
      draftKept: back.composer.draft === text,
      editorShowsDraft: backText === text,
      leakedIntoOtherDraft: (onOther.composer.drafts[otherKey] ?? "") !== "",
      leakedIntoOtherEditor: otherText.includes(text),
    } satisfies Metrics;
  }, failure),

  draftBackground: Effect.fn("scenario.draftBackground")(function* (ctx: ScenarioContext) {
    const text = `Draft ${(yield* uuid).slice(0, 8)}`;
    const threadId = yield* freshThread(ctx);
    yield* openThread(ctx, threadId);
    yield* typeInComposer(ctx, text);
    yield* ctx.device.home;
    yield* Effect.sleep("3 seconds");

    yield* ctx.device.run([
      "open",
      APP_ID,
      "--launch-url",
      `${SCHEME}://${threadPath(ctx, threadId)}`,
    ]);
    const back = yield* ctx.device.waitFor("the thread after foreground", (state) =>
      isThread(state, threadId),
    );
    return {
      draftKept: back.composer.draft === text,
      editorShowsDraft: (yield* composerText(ctx)) === text,
    } satisfies Metrics;
  }, failure),

  tapComposer: Effect.fn("scenario.tapComposer")(function* (ctx: ScenarioContext) {
    const threadId = yield* freshThread(ctx);
    yield* openThread(ctx, threadId);
    const node = yield* composerNode(ctx);
    const { x, y } = ctx.device.center(node);
    yield* ctx.device.pressAt(x, y);
    yield* Effect.sleep("1500 millis");
    const after = yield* ctx.device.state;
    return {
      stayedOnThread: isThread(after, threadId),
      editorFocused:
        after.composer.editors.some((editor) => editor.expanded) && after.composer.keyboard,
    } satisfies Metrics;
  }, failure),

  skillPick: Effect.fn("scenario.skillPick")(function* (ctx: ScenarioContext) {
    yield* openThread(ctx, yield* freshThread(ctx));

    yield* typeInComposer(ctx, "/eval");
    const composer = yield* composerNode(ctx);

    let item: AxNode | undefined;
    for (let attempt = 0; attempt < 10 && !item?.rect; attempt++) {
      yield* Effect.sleep("1 second");
      item = (yield* ctx.device.nodes).find(
        (node) =>
          node.rect !== undefined &&
          node.rect.y + node.rect.height <= composer.rect!.y &&
          node.label?.includes(", skill:eval-notes") === true,
      );
    }
    if (!item?.rect)
      return yield* new ScenarioFailure({ message: "The / menu did not list skill:eval-notes." });
    const { x, y } = ctx.device.center(item);
    yield* ctx.device.pressAt(x, y);
    yield* Effect.sleep("1500 millis");
    const after = yield* ctx.device.state;
    return {
      editorFocused:
        after.composer.editors.some((editor) => editor.expanded) && after.composer.keyboard,
    } satisfies Metrics;
  }, failure),

  failedSend: Effect.fn("scenario.failedSend")(function* (ctx: ScenarioContext) {
    const { threadId, lock } = yield* ctx.env.launchLockable("Locked thread");
    yield* openThread(ctx, threadId);
    const text = `Will fail ${(yield* uuid).slice(0, 8)}`;
    yield* typeInComposer(ctx, text);
    yield* lock;

    yield* Effect.sleep("2 seconds");

    const sendBlocked =
      (yield* ctx.device.nodes).find((node) => node.label === "Send")?.enabled === false;
    if (!sendBlocked) yield* ctx.device.press('label="Send"');
    const shown = sendBlocked
      ? false
      : (yield* ctx.device
          .waitFor("a composer error", (state) => state.composer.error !== null, 8_000)
          .pipe(Effect.option))._tag === "Some";
    return {
      sendBlocked,
      errorShown: shown,
      silentFailure: !sendBlocked && !shown,
    } satisfies Metrics;
  }, failure),

  workingShelfFinish: Effect.fn("scenario.workingShelfFinish")(function* (ctx: ScenarioContext) {
    const key = `shelf-${(yield* uuid).slice(0, 8)}`;
    const threadId = yield* ctx.env.launch("Shelf work", `Run the job. [[eval:hold:${key}]]`);
    const working = yield* ctx.device.waitFor(
      "the thread to show as working",
      (state) => state.threads[threadId] === "working",
    );
    yield* ctx.env.release(key);
    yield* ctx.env.settled(threadId);

    yield* Effect.sleep("5 seconds");
    const after = yield* ctx.device.state;
    return {
      shelfShownWhileWorking: shelfCount(working) > 0,
      shelfCountAfter: shelfCount(after),

      appWorkingThreads: Object.values(after.threads).filter((status) => status === "working")
        .length,
      statusAfter: after.threads[threadId] ?? "missing",
    } satisfies Metrics;
  }, failure),

  pendingQuestion: Effect.fn("scenario.pendingQuestion")(function* (ctx: ScenarioContext) {
    const threadId = yield* ctx.env.launch("Question", `Ask me first. [[eval:question]]`);
    yield* ctx.env.waitForPendingInput(threadId);
    yield* Effect.sleep("2 seconds");
    const after = yield* ctx.device.state;
    yield* ctx.env.interruptAll();
    return {
      status: after.threads[threadId] ?? "missing",
      shelfCount: shelfCount(after),
    } satisfies Metrics;
  }, failure),

  subagentsRunning: Effect.fn("scenario.subagentsRunning")(function* (ctx: ScenarioContext) {
    const key = `sub-${(yield* uuid).slice(0, 8)}`;
    const threadId = yield* ctx.env.launch("Subagents", `Fan out. [[eval:subagents:${key}]]`);
    yield* ctx.env.waitForSubagents(threadId);
    yield* Effect.sleep("2 seconds");
    const home = yield* ctx.device.state;
    yield* openThread(ctx, threadId);
    yield* Effect.sleep("1500 millis");
    const thread = yield* ctx.device.state;
    yield* ctx.env.release(key);
    yield* ctx.env.settled(threadId);
    return {
      status: home.threads[threadId] ?? "missing",
      threadShowsStatus: thread.floatingStatus !== null,
    } satisfies Metrics;
  }, failure),

  openSubagentThread: Effect.fn("scenario.openSubagentThread")(function* (ctx: ScenarioContext) {
    const key = `child-${(yield* uuid).slice(0, 8)}`;
    const threadId = yield* ctx.env.launch("Parent", `Fan out. [[eval:subagents:${key}]]`);
    yield* ctx.env.waitForSubagents(threadId);
    yield* ctx.env.release(key);
    const projection = yield* ctx.env.settled(threadId);
    const child = projection.subagents.find(
      (subagent) => subagent.childThreadId !== null,
    )?.childThreadId;
    if (!child)
      return yield* new ScenarioFailure({ message: "The subagent made no child thread." });
    yield* openThread(ctx, child);
    const { height, threadX } = yield* geometry(ctx);
    const recording = yield* recordFor(
      ctx,
      true,
      Effect.gen(function* () {
        yield* ctx.device.swipe(threadX, Math.round(height * 0.7), Math.round(height * 0.3));
        yield* ctx.device.swipe(threadX, Math.round(height * 0.3), Math.round(height * 0.7));
      }),
    );
    return {
      movedPx: feedMotion(recording.feed, 0).movedPx ?? 0,
      ...frameMetrics(recording),
    } satisfies Metrics;
  }, failure),

  pinFromLongPress: Effect.fn("scenario.pinFromLongPress")(function* (ctx: ScenarioContext) {
    const title = `Pin target ${(yield* uuid).slice(0, 6)}`;
    const target = yield* ctx.env.launch(title, "Hi. [[eval:reply]]");
    yield* ctx.env.settled(target);
    yield* waitForRow(ctx, title);

    for (let attempt = 0; attempt < 2; attempt++) {
      yield* ctx.device.longPress(rowSelector(title));
      yield* Effect.sleep("1 second");
      if ((yield* ctx.device.nodes).some((node) => node.label === "Pin")) break;
    }
    yield* ctx.device.press('label="Pin"');
    yield* Effect.sleep("2 seconds");
    const shell = yield* ctx.env.shell();
    const pinned = shell.threads
      .filter((thread) => thread.pinnedAt != null)
      .map((thread) => thread.id);
    for (const id of pinned) yield* ctx.env.unpin(id);
    return {
      targetPinned: pinned.includes(target),
      otherPinned: pinned.filter((id) => id !== target).length,
    } satisfies Metrics;
  }, failure),

  linkToNewThread: Effect.fn("scenario.linkToNewThread")(function* (ctx: ScenarioContext) {
    const threadId = yield* ctx.env.launch("Linked thread", "Hi. [[eval:reply]]");
    yield* ctx.device.open(threadPath(ctx, threadId));
    yield* Effect.sleep("4 seconds");
    const after = yield* ctx.device.state;
    return { opensTarget: isThread(after, threadId) } satisfies Metrics;
  }, failure),

  linkToArchivedThread: Effect.fn("scenario.linkToArchivedThread")(function* (
    ctx: ScenarioContext,
  ) {
    const threadId = yield* ctx.env.launch("Archived thread", "Hi. [[eval:reply]]");
    yield* ctx.env.settled(threadId);
    yield* ctx.env.archive(threadId);
    yield* Effect.sleep("1 second");
    yield* ctx.device.open(threadPath(ctx, threadId));
    yield* Effect.sleep("4 seconds");
    const after = yield* ctx.device.state;
    return { opensTarget: isThread(after, threadId) } satisfies Metrics;
  }, failure),

  openFromList: Effect.fn("scenario.openFromList")(function* (ctx: ScenarioContext) {
    const title = `Open me ${(yield* uuid).slice(0, 6)}`;
    const target = yield* ctx.env.launch(title, "Hi. [[eval:reply]]");
    yield* ctx.env.settled(target);
    yield* waitForRow(ctx, title);

    yield* Effect.sleep("1 second");
    yield* ctx.device.press(rowSelector(title));
    const after = yield* ctx.device
      .waitFor("the tapped thread", (state) => isThread(state, target))
      .pipe(Effect.option);
    return { opensTarget: after._tag === "Some" } satisfies Metrics;
  }, failure),

  duoBackThenOpen: Effect.fn("scenario.duoBackThenOpen")(function* (ctx: ScenarioContext) {
    const tag = (yield* uuid).slice(0, 6);
    const first = yield* ctx.env.launch(`Duo first ${tag}`, "Hi. [[eval:reply]]");
    const next = yield* ctx.env.launch(`Duo next ${tag}`, "Hi. [[eval:reply]]");
    yield* ctx.env.settled(first);
    yield* ctx.env.settled(next);
    yield* waitForRow(ctx, `Duo first ${tag}`);
    yield* ctx.device.press(rowSelector(`Duo first ${tag}`));
    yield* ctx.device.waitFor("the first thread", (state) => isThread(state, first));
    yield* ctx.device.back;
    yield* ctx.device.waitFor("Home", (state) => state.route?.name === "Home");
    yield* ctx.device.press(rowSelector(`Duo next ${tag}`));
    yield* Effect.sleep("2 seconds");
    const after = yield* ctx.device.state;

    const nodes = yield* ctx.device.nodes;
    const screen = nodes[0]?.rect;

    const bars = nodes.flatMap((node) =>
      node.kind === "navigation-bar" && node.rect ? [node.rect] : [],
    );
    const title = nodes.find(
      (node) =>
        node.label === `Duo next ${tag}` &&
        bars.some((bar) => node.rect && node.rect.y >= bar.y && node.rect.y < bar.y + bar.height),
    )?.rect;
    return {
      opensTarget: isThread(after, next),
      titleOnScreen:
        screen !== undefined &&
        title !== undefined &&
        title.x >= screen.x &&
        title.x + title.width <= screen.x + screen.width,
    } satisfies Metrics;
  }, failure),
} satisfies Record<string, Scenario>;

export type ScenarioName = keyof typeof SCENARIOS;

function rowSelector(title: string) {
  return `label="${title}"`;
}

const waitForStill = Effect.fn("scenario.waitForStill")(function* (ctx: ScenarioContext) {
  let previous = -1;
  for (let attempt = 0; attempt < 20; attempt++) {
    const scroll = (yield* ctx.device.state).feed?.scroll ?? -1;
    if (scroll === previous) return;
    previous = scroll;
    yield* Effect.sleep("500 millis");
  }
});

function settledFromEnd(samples: ReadonlyArray<FeedSample>) {
  let worst = 0;
  for (let index = 1; index < samples.length; index++)
    if (samples[index]!.content === samples[index - 1]!.content)
      worst = Math.max(worst, samples[index]!.fromEnd ?? 0);
  return worst;
}

const waitForRow = Effect.fn("scenario.waitForRow")(function* (
  ctx: ScenarioContext,
  title: string,
) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const nodes = yield* ctx.device.nodes;
    if (nodes.some((node) => node.label?.includes(title))) return;

    if (attempt === 4) yield* ctx.device.run(["scroll", "top"]).pipe(Effect.ignore);

    const shelf = nodes.find((node) => /^\d+ working threads?$/.test(node.label ?? ""));
    const collapsed = (yield* ctx.device.state).homeList?.some(
      (entry) => entry.type === "v2-working-shelf" && entry.expanded === false,
    );
    if (attempt === 10 && collapsed && shelf?.label)
      yield* ctx.device.press(`label="${shelf.label}"`);
    yield* Effect.sleep("500 millis");
  }
  return yield* new ScenarioFailure({ message: `Row "${title}" never appeared on Home.` });
});

function shelfCount(state: ProbeState) {
  return state.homeList?.find((entry) => entry.type === "v2-working-shelf")?.count ?? 0;
}
