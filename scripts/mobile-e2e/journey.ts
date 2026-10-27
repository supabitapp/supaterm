// @effect-diagnostics nodeBuiltinImport:off globalTimers:off - Host-side device automation.

import * as NodePath from "node:path";
import * as NodeFSP from "node:fs/promises";
import * as NodeProcess from "node:process";

import {
  check,
  type Check,
  describeRect,
  findLabel,
  keyboardRect,
  layoutChecks,
  type Rect,
  type Snapshot,
  type SnapshotNode,
  tabBarRect,
} from "./checks.ts";
import { BUNDLE_ID } from "./build.ts";
import type { Device } from "./device.ts";
import { delay } from "./process.ts";
import { lagCheck } from "./video.ts";

export interface StepResult {
  readonly name: string;
  readonly checks: ReadonlyArray<Check>;
  readonly screenshot?: string;
  readonly video?: string;
  readonly lagFrame?: string;
}
const THREAD_TITLE = /Explain why a machine is offline/;
const BACK = /^(Back|Navigate up|Go back)$/i;

const backButton = (snapshot: Snapshot) =>
  snapshot.nodes.find((node) => node.identifier === "BackButton") ?? findLabel(snapshot, BACK);
const composer = (snapshot: Snapshot) =>
  snapshot.nodes
    .filter(
      (node) =>
        (node.kind === "text-field" || node.kind === "text-view" || node.editable === true) &&
        node.rect &&
        node.rect.y < snapshot.viewport.height &&
        node.bundleId !== "com.android.systemui",
    )
    .toSorted((a, b) => b.rect!.y - a.rect!.y)[0];
const threadRow = (snapshot: Snapshot) => findLabel(snapshot, THREAD_TITLE);

const inside = (rect: Rect | undefined, snapshot: Snapshot) =>
  rect !== undefined &&
  rect.x >= 0 &&
  rect.y >= 0 &&
  rect.x + rect.width <= snapshot.viewport.width + 1 &&
  rect.y + rect.height <= snapshot.viewport.height + 1;

const topBand = (snapshot: Snapshot): Rect => ({
  x: snapshot.viewport.width * 0.25,
  y: snapshot.viewport.height * 0.03,
  width: snapshot.viewport.width * 0.5,
  height: snapshot.viewport.height * 0.09,
});

export async function runJourney(
  device: Device,
  directory: string,
  pair: () => Promise<string>,
  steps: StepResult[],
): Promise<void> {
  const phone = device.pose.form === "phone";
  const tap = async (node: SnapshotNode | undefined, label: string) => {
    if (!node?.ref || !node.rect) throw new Error(`no ${label} to tap`);
    await device
      .agent(["press", `@${node.ref}`])
      .catch(() =>
        device.agent([
          "press",
          String(Math.round(node.rect!.x + node.rect!.width / 2)),
          String(Math.round(node.rect!.y + node.rect!.height / 2)),
        ]),
      );
  };

  const capture = async (
    name: string,
    snapshot: Snapshot,
    expectations: ReadonlyArray<Check> = [],
    extra: Partial<StepResult> = {},
  ) => {
    const screenshot = NodePath.join(directory, `${steps.length + 1}-${name}.png`);
    await device.screenshot(screenshot);
    await NodeFSP.writeFile(
      screenshot.replace(/\.png$/, ".json"),
      JSON.stringify(snapshot, null, 2),
    );
    const step = {
      name,
      checks: [...layoutChecks(snapshot, BUNDLE_ID), ...expectations],
      screenshot,
      ...extra,
    };
    steps.push(step);
    return step;
  };
  const loaded = (snapshot: Snapshot) =>
    findLabel(snapshot, /Add environment|New (chat|thread)/i) !== undefined;
  const errorDialog = (snapshot: Snapshot) =>
    findLabel(snapshot, /^(Dismiss|OK|Close)$/) !== undefined
      ? findLabel(snapshot, /^Could not|failed|went wrong/i)
      : undefined;
  const systemDialog = (snapshot: Snapshot) =>
    snapshot.nodes.find(
      (node) =>
        node.bundleId === "android" &&
        node.identifier === "android:id/alertTitle" &&
        /^(System UI|Google Play services) isn't responding$/.test(node.label ?? ""),
    );
  const launchFailure = (snapshot: Snapshot) =>
    findLabel(snapshot, /^(There was a problem loading the project\.?|Failed to load app from)/i);
  for (let dialogs = 0; ; dialogs++) {
    const launch = await device.waitFor(
      (snapshot) =>
        loaded(snapshot) ||
        errorDialog(snapshot) !== undefined ||
        launchFailure(snapshot) !== undefined ||
        systemDialog(snapshot) !== undefined,
      "the app to load",
      180_000,
    );
    const failure = launchFailure(launch);
    if (failure) {
      const message = launch.nodes
        .flatMap((node) => (node.label ? [node.label] : []))
        .filter((label) => /problem loading|Failed to load app from/i.test(label))
        .join("; ");
      await capture("launch failure", launch, [check("app loaded", false, message)]);
      throw new Error(message);
    }
    const system = systemDialog(launch);
    if (system) {
      const evidence = NodePath.join(directory, `startup-dialog-${dialogs + 1}`);
      await device.screenshot(`${evidence}.png`);
      await NodeFSP.writeFile(`${evidence}.json`, JSON.stringify(launch, null, 2));
      if (dialogs >= 2) throw new Error(`${system.label} during device startup`);
      NodeProcess.stderr.write(`[mobile-e2e] ${device.pose.id}: waiting for ${system.label}\n`);
      await tap(
        launch.nodes.find(
          (node) => node.bundleId === "android" && node.identifier === "android:id/aerr_wait",
        ),
        "system dialog Wait button",
      );
      continue;
    }
    const dialog = errorDialog(launch);
    if (!dialog || dialogs >= 3) break;
    await capture("launch error", launch, [
      check("no error dialog on launch", false, dialog.label ?? "error dialog"),
    ]);
    await device.agent(["press", `label="${findLabel(launch, /^(Dismiss|OK|Close)$/)!.label}"`]);
    await delay(1_000);
  }
  if (device.pose.fold) await device.agent(["fold", device.pose.fold]);
  let threads: Snapshot | null = null;
  for (let attempt = 1; attempt <= 2 && !threads; attempt++) {
    const pairing = new URLSearchParams({ pairingUrl: await pair(), autoConnect: "1" });
    await device.openUrl(`supaterm-dev://connections/new?${pairing}`);
    threads = await device
      .waitFor((snapshot) => threadRow(snapshot) !== undefined, "the paired thread list", 60_000)
      .catch(() => null);
  }
  if (!threads) throw new Error("the app did not show the fixture threads after pairing");
  await delay(1_000);
  threads = await device.orient(device.pose.landscape ? "landscape" : "portrait");
  const tabs = tabBarRect(threads);
  const wide = threads.viewport.width > threads.viewport.height;
  await capture("threads", threads, [
    check(
      device.pose.landscape ? "in landscape" : "in portrait",
      wide === Boolean(device.pose.landscape),
      `${Math.round(threads.viewport.width)}×${Math.round(threads.viewport.height)}`,
    ),
    check("thread list visible", threadRow(threads) !== undefined, "fixture threads"),
    ...(phone ? [check("tab bar visible", inside(tabs, threads), describeRect(tabs))] : []),
  ]);

  const opening = await device.recorded(directory, "open-thread", async () =>
    tap(threadRow(await device.snapshot()), "thread row"),
  );
  const thread = await device.waitFor(
    (snapshot) => composer(snapshot) !== undefined && threadRow(snapshot) !== undefined,
    "the thread screen",
  );
  const pushed = phone || backButton(thread) !== undefined;
  const bottomTabs = pushed && tabs && tabs.width > tabs.height ? tabs : undefined;
  const openLag = bottomTabs
    ? await lagCheck(
        "no tabs over the entering thread (video)",
        {
          video: opening,
          nav: topBand(threads),
          chrome: bottomTabs,
          viewport: threads.viewport,
        },
        NodePath.join(directory, "open-thread-lag.png"),
      )
    : null;
  await capture(
    "thread",
    thread,
    [
      check(
        "composer inside the screen",
        inside(composer(thread)?.rect, thread),
        describeRect(composer(thread)?.rect),
      ),
      ...(phone ? [check("back button visible", backButton(thread) !== undefined, "back")] : []),
      ...(bottomTabs
        ? [
            check(
              "tab bar hidden",
              tabBarRect(thread) === undefined,
              describeRect(tabBarRect(thread)),
            ),
          ]
        : []),
      ...(openLag ? [openLag.check] : []),
    ],
    {
      video: opening,
      ...(openLag?.frame ? { lagFrame: openLag.frame } : {}),
    },
  );

  const input = composer(thread)!;
  const swipeX = Math.round(input.rect!.x + input.rect!.width / 2);
  const swipeTop = Math.round(thread.viewport.height * 0.25);
  const swipeBottom = Math.round(Math.min(input.rect!.y - 30, thread.viewport.height * 0.7));
  await device.agent([
    "swipe",
    String(swipeX),
    String(swipeTop),
    String(swipeX),
    String(swipeBottom),
  ]);
  await delay(800);
  await capture("scrolled up", await device.snapshot());
  await device.agent([
    "swipe",
    String(swipeX),
    String(swipeBottom),
    String(swipeX),
    String(swipeTop),
  ]);
  await delay(800);

  await tap(composer(await device.snapshot()), "composer");
  await device.agent(["type", "Checking the composer above the keyboard"]);
  await delay(1_200);
  const typing = await device.snapshot();
  await capture("typing", typing, [
    check(
      "keyboard visible",
      keyboardRect(typing) !== undefined,
      describeRect(keyboardRect(typing)),
    ),
    check(
      "composer visible while typing",
      inside(composer(typing)?.rect, typing),
      describeRect(composer(typing)?.rect),
    ),
    check(
      "composer above the keyboard",
      keyboardRect(typing) === undefined ||
        (composer(typing)?.rect?.y ?? Infinity) < keyboardRect(typing)!.y,
      `composer ${describeRect(composer(typing)?.rect)}, keyboard ${describeRect(keyboardRect(typing))}`,
    ),
  ]);
  await device.agent(["keyboard", "dismiss"]).catch(() => undefined);
  await delay(800);

  if (pushed) {
    const back = await device.recorded(directory, "back", async () => {
      const current = await device.snapshot();
      const button = backButton(current);
      if (button) await tap(button, "back button");
      else await device.agent(["back"]);
    });
    const list = await device.waitFor(
      (snapshot) => backButton(snapshot) === undefined && threadRow(snapshot) !== undefined,
      "the thread list",
    );
    const backLag = bottomTabs
      ? await lagCheck(
          "tabs return with the list (video)",
          {
            video: back,
            nav: topBand(list),
            chrome: bottomTabs,
            viewport: list.viewport,
          },
          NodePath.join(directory, "back-lag.png"),
        )
      : null;
    await capture(
      "back",
      list,
      [
        check("tab bar back", inside(tabBarRect(list), list), describeRect(tabBarRect(list))),
        ...(backLag ? [backLag.check] : []),
      ],
      {
        video: back,
        ...(backLag?.frame ? { lagFrame: backLag.frame } : {}),
      },
    );
  }
  await tap(findLabel(await device.snapshot(), /^(Settings|Open settings)$/), "settings button");
  const settings = await device.waitFor(
    (snapshot) => findLabel(snapshot, /^Appearance$/) !== undefined,
    "settings",
  );
  await capture("settings", settings);

  if (device.pose.form === "tablet" && !device.pose.fold) {
    await capture("rotated", await device.orient(device.pose.landscape ? "portrait" : "landscape"));
  }
  if (device.pose.fold) {
    await device.agent(["fold", device.pose.fold === "open" ? "closed" : "open"]);
    await delay(2_500);
    await capture(device.pose.fold === "open" ? "folded" : "unfolded", await device.snapshot());
  }
}
