#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Host-side capture script drives git, a server subprocess, and a browser directly.

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeModule from "node:module";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeSqlite from "node:sqlite";
import * as NodeUtil from "node:util";

import {
  OrchestrationV2AppThreadJson,
  OrchestrationV2CheckpointJson,
  OrchestrationV2CheckpointScopeJson,
  OrchestrationV2ConversationMessageJson,
  OrchestrationV2ExecutionNodeJson,
  OrchestrationV2RunJson,
  OrchestrationV2RuntimeRequestJson,
  OrchestrationV2TurnItemJson,
} from "@supaterm/contracts";
import * as Schema from "effect/Schema";
import { chromium, type Page } from "playwright-core";
import sharp from "sharp";

import {
  HERO_THREAD,
  SCENE_PROJECTS,
  DONE_THREADS,
  SIDEBAR_THREADS,
  type SceneModel,
  type ScenePullRequest,
  type SceneSidebarThread,
} from "./marketing-hero.scene.ts";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "..");
const SERVER_BIN = NodePath.join(REPO_ROOT, "apps/server/src/bin.ts");
const DEFAULT_OUTPUT = NodePath.join(REPO_ROOT, "apps/marketing/src/assets/app-desktop.webp");
const VIEWPORT = { width: 1440, height: 900 };
const CHECKPOINT_REFS_PREFIX = "refs/supaterm/orchestration-v2/checkpoints";

const NOW = Date.now();
const isoMinutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

const GIT_ENV = {
  ...NodeProcess.env,
  GIT_CONFIG_GLOBAL: NodeOS.devNull,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Orbit Dev",
  GIT_AUTHOR_EMAIL: "dev@orbit.example",
  GIT_COMMITTER_NAME: "Orbit Dev",
  GIT_COMMITTER_EMAIL: "dev@orbit.example",
};

function git(cwd: string, ...args: ReadonlyArray<string>): string {
  return NodeChildProcess.execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
}

async function writeFiles(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const target = NodePath.join(root, path);
    await NodeFSP.mkdir(NodePath.dirname(target), { recursive: true });
    await NodeFSP.writeFile(target, content);
  }
}

function run(command: string, args: ReadonlyArray<string>, env = NodeProcess.env): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(command, args, { cwd: REPO_ROOT, env, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
  });
}

interface CheckpointFile {
  readonly path: string;
  readonly kind: string;
  readonly additions: number;
  readonly deletions: number;
}

interface Workspace {
  readonly projectRoots: ReadonlyMap<string, string>;
  readonly worktreeFor: (thread: { readonly project: string; readonly branch: string }) => string;
  readonly heroScopeId: string;
  readonly heroCheckpoints: ReadonlyArray<{
    readonly ref: string;
    readonly files: CheckpointFile[];
  }>;
}

function checkpointRef(scopeId: string, ordinal: number): string {
  const scopeKey = NodeCrypto.createHash("sha256").update(scopeId).digest("hex").slice(0, 32);
  return `${CHECKPOINT_REFS_PREFIX}/${Buffer.from(scopeKey).toString("base64url")}/ordinal/${ordinal}`;
}

async function createWorkspace(root: string): Promise<Workspace> {
  const projectRoots = new Map<string, string>();
  for (const project of SCENE_PROJECTS) {
    const projectRoot = NodePath.join(root, "repos", project.title);
    await NodeFSP.mkdir(projectRoot, { recursive: true });
    git(projectRoot, "init", "-q", "-b", "main");
    await writeFiles(projectRoot, project.files);
    git(projectRoot, "add", "-A");
    git(projectRoot, "commit", "-q", "-m", "Initial commit");
    projectRoots.set(project.title, projectRoot);
  }

  const worktreeFor = (thread: { readonly project: string; readonly branch: string }) =>
    NodePath.join(root, "worktrees", thread.project, thread.branch.replaceAll("/", "-"));
  for (const thread of [HERO_THREAD, ...SIDEBAR_THREADS]) {
    git(
      projectRoots.get(thread.project)!,
      "worktree",
      "add",
      "-q",
      worktreeFor(thread),
      "-b",
      thread.branch,
    );
  }

  const heroWorktree = worktreeFor(HERO_THREAD);
  const heroScopeId = `checkpoint-scope:thread:${HERO_THREAD.id}:name:root`;
  let parent = git(heroWorktree, "rev-parse", "HEAD");
  git(heroWorktree, "update-ref", checkpointRef(heroScopeId, 0), parent);
  const heroCheckpoints: Array<{ ref: string; files: CheckpointFile[] }> = [];
  for (const [index, turn] of HERO_THREAD.turns.entries()) {
    await writeFiles(heroWorktree, turn.files);
    git(heroWorktree, "add", "-A");
    const tree = git(heroWorktree, "write-tree");
    const commit = git(
      heroWorktree,
      "commit-tree",
      tree,
      "-p",
      parent,
      "-m",
      `Checkpoint ${index + 1}`,
    );
    const ref = checkpointRef(heroScopeId, index + 1);
    git(heroWorktree, "update-ref", ref, commit);
    const files = git(heroWorktree, "diff", "--numstat", parent, commit)
      .split("\n")
      .map((line) => {
        const [additions, deletions, path] = line.split("\t");
        return {
          path: path!,
          kind: "modified",
          additions: Number(additions),
          deletions: Number(deletions),
        };
      });
    heroCheckpoints.push({ ref, files });
    parent = commit;
  }
  git(heroWorktree, "reset", "-q");

  return { projectRoots, worktreeFor, heroScopeId, heroCheckpoints };
}

type Row = Record<string, NodeSqlite.SQLInputValue>;

function runIdsFor(threadId: string, ordinal: number) {
  const runId = `run:thread:${threadId}:ordinal:${ordinal}`;
  return { runId, nodeId: `node:run:${encodeURIComponent(runId)}:root` };
}

function encodePayload(schema: Schema.Codec<unknown, unknown>, payload: object): string {
  try {
    Schema.decodeSync(schema)(payload);
  } catch (error) {
    const id = "id" in payload ? String(payload.id) : "payload";
    throw new Error(`${id} no longer matches its contract schema:\n${String(error)}`, {
      cause: error,
    });
  }
  return JSON.stringify(payload);
}

function seed(db: NodeSqlite.DatabaseSync, workspace: Workspace): void {
  const insert = (table: string, row: Row) => {
    const columns = Object.keys(row);
    db.prepare(
      `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    ).run(...Object.values(row));
  };

  const projectIds = new Map<string, string>();
  for (const project of SCENE_PROJECTS) {
    const projectId = NodeCrypto.randomUUID();
    const createdAt = isoMinutesAgo(60 * 24 * 30);
    insert("projection_projects", {
      project_id: projectId,
      title: project.title,
      workspace_root: workspace.projectRoots.get(project.title)!,
      scripts_json: "[]",
      created_at: createdAt,
      updated_at: createdAt,
    });
    projectIds.set(project.title, projectId);
  }

  const insertThread = (input: {
    readonly id: string;
    readonly project: string;
    readonly title: string;
    readonly model: SceneModel;
    readonly branch: string;
    readonly worktreePath: string | null;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly pullRequest?: ScenePullRequest;
    readonly done?: boolean;
  }) => {
    const payload = {
      createdBy: "user",
      creationSource: "web",
      id: input.id,
      projectId: projectIds.get(input.project)!,
      title: input.title,
      providerInstanceId: input.model.instanceId,
      modelSelection: input.model,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: input.branch,
      worktreePath: input.worktreePath,
      pullRequests: input.pullRequest
        ? [pullRequestLink(input.title, input.branch, input.pullRequest, input.updatedAt)]
        : [],
      activeProviderThreadId: null,
      lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: input.id },
      forkedFrom: null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      archivedAt: null,
      doneOverride: input.done ? "done" : null,
      doneAt: input.done ? input.updatedAt : null,
      snoozedUntil: null,
      snoozedAt: null,
      lastVisitedAt: input.updatedAt,
      deletedAt: null,
    };
    insert("orchestration_v2_projection_threads", {
      thread_id: input.id,
      project_id: payload.projectId,
      title: input.title,
      default_provider: input.model.instanceId,
      provider_instance_id: input.model.instanceId,
      runtime_mode: payload.runtimeMode,
      interaction_mode: payload.interactionMode,
      active_provider_thread_id: null,
      created_at: input.createdAt,
      updated_at: input.updatedAt,
      archived_at: null,
      deleted_at: null,
      payload_json: encodePayload(OrchestrationV2AppThreadJson, payload),
    });
  };

  const insertRun = (input: {
    readonly threadId: string;
    readonly ordinal: number;
    readonly runId: string;
    readonly nodeId: string;
    readonly model: SceneModel;
    readonly status: "running" | "waiting" | "completed";
    readonly userMessageId: string;
    readonly startedAt: string;
    readonly completedAt: string | null;
    readonly checkpointId: string | null;
    readonly checkpointScopeId: string | null;
  }) => {
    const { runId, nodeId: rootNodeId } = input;
    insert("orchestration_v2_projection_runs", {
      run_id: runId,
      thread_id: input.threadId,
      ordinal: input.ordinal,
      provider: input.model.instanceId,
      provider_instance_id: input.model.instanceId,
      provider_thread_id: null,
      status: input.status,
      requested_at: input.startedAt,
      completed_at: input.completedAt,
      payload_json: encodePayload(OrchestrationV2RunJson, {
        id: runId,
        threadId: input.threadId,
        ordinal: input.ordinal,
        providerInstanceId: input.model.instanceId,
        modelSelection: input.model,
        providerThreadId: null,
        userMessageId: input.userMessageId,
        rootNodeId,
        activeAttemptId: null,
        status: input.status,
        queuePosition: null,
        requestedAt: input.startedAt,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        checkpointId: input.checkpointId,
        contextHandoffId: null,
      }),
    });
    const nodeStatus = input.status === "completed" ? "completed" : "running";
    insert("orchestration_v2_projection_nodes", {
      node_id: rootNodeId,
      thread_id: input.threadId,
      run_id: runId,
      parent_node_id: null,
      root_node_id: rootNodeId,
      kind: "root_turn",
      status: nodeStatus,
      provider_thread_id: null,
      provider_turn_id: null,
      runtime_request_id: null,
      checkpoint_scope_id: input.checkpointScopeId,
      started_at: input.startedAt,
      completed_at: input.completedAt,
      payload_json: encodePayload(OrchestrationV2ExecutionNodeJson, {
        id: rootNodeId,
        threadId: input.threadId,
        runId,
        parentNodeId: null,
        rootNodeId,
        kind: "root_turn",
        status: nodeStatus,
        countsForRun: true,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        runtimeRequestId: null,
        checkpointScopeId: input.checkpointScopeId,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
      }),
    });
  };

  const insertMessage = (input: {
    readonly id: string;
    readonly threadId: string;
    readonly runId: string;
    readonly nodeId: string;
    readonly role: "user" | "assistant";
    readonly text: string;
    readonly at: string;
  }) => {
    insert("orchestration_v2_projection_messages", {
      message_id: input.id,
      thread_id: input.threadId,
      run_id: input.runId,
      node_id: input.nodeId,
      role: input.role,
      streaming: 0,
      created_at: input.at,
      updated_at: input.at,
      payload_json: encodePayload(OrchestrationV2ConversationMessageJson, {
        createdBy: input.role === "user" ? "user" : "agent",
        creationSource: input.role === "user" ? "web" : "provider",
        id: input.id,
        threadId: input.threadId,
        runId: input.runId,
        nodeId: input.nodeId,
        role: input.role,
        text: input.text,
        attachments: [],
        streaming: false,
        createdAt: input.at,
        updatedAt: input.at,
      }),
    });
  };

  const insertTurnItem = (input: {
    readonly threadId: string;
    readonly runId: string;
    readonly nodeId: string;
    readonly ordinal: number;
    readonly startedAt: string;
    readonly completedAt: string;
    readonly item: { readonly type: string } & Record<string, unknown>;
  }) => {
    const id = `turn-item:${encodeURIComponent(input.runId)}:${input.ordinal}`;
    insert("orchestration_v2_projection_turn_items", {
      turn_item_id: id,
      thread_id: input.threadId,
      run_id: input.runId,
      node_id: input.nodeId,
      provider_thread_id: null,
      provider_turn_id: null,
      parent_item_id: null,
      ordinal: input.ordinal,
      type: input.item.type,
      status: "completed",
      updated_at: input.completedAt,
      payload_json: encodePayload(OrchestrationV2TurnItemJson, {
        id,
        threadId: input.threadId,
        runId: input.runId,
        nodeId: input.nodeId,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: input.ordinal,
        status: "completed",
        title: null,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        updatedAt: input.completedAt,
        ...input.item,
      }),
    });
  };

  const insertUserTurnStart = (input: {
    readonly threadId: string;
    readonly runId: string;
    readonly nodeId: string;
    readonly ordinal: number;
    readonly text: string;
    readonly at: string;
  }) => {
    const { threadId, runId, nodeId, ordinal, text, at } = input;
    const messageId = NodeCrypto.randomUUID();
    insertMessage({ id: messageId, threadId, runId, nodeId, role: "user", text, at });
    insertTurnItem({
      threadId,
      runId,
      nodeId,
      ordinal: ordinal * 1_000_000 + 1,
      startedAt: at,
      completedAt: at,
      item: {
        type: "user_message",
        createdBy: "user",
        creationSource: "web",
        messageId,
        inputIntent: "turn_start",
        text,
        attachments: [],
      },
    });
    return messageId;
  };

  const hero = HERO_THREAD;
  const heroWorktree = workspace.worktreeFor(hero);
  const heroTimes = hero.turns.map((turn) => ({
    startedAt: isoMinutesAgo(turn.startedMinutesAgo),
    completedAt: new Date(
      NOW - turn.startedMinutesAgo * 60_000 + turn.workedSeconds * 1000,
    ).toISOString(),
  }));
  insertThread({
    id: hero.id,
    project: hero.project,
    title: hero.title,
    model: hero.model,
    branch: hero.branch,
    worktreePath: heroWorktree,
    createdAt: heroTimes[0]!.startedAt,
    updatedAt: heroTimes.at(-1)!.completedAt,
    pullRequest: hero.pullRequest,
  });
  const checkpointId = (ordinal: number) =>
    `checkpoint:scope:${encodeURIComponent(workspace.heroScopeId)}:name:${ordinal}`;
  const heroRuns = hero.turns.map((turn, index) => {
    const ordinal = index + 1;
    const { startedAt, completedAt } = heroTimes[index]!;
    const { runId, nodeId } = runIdsFor(hero.id, ordinal);
    const userMessageId = insertUserTurnStart({
      threadId: hero.id,
      runId,
      nodeId,
      ordinal,
      text: turn.prompt,
      at: startedAt,
    });
    insertRun({
      threadId: hero.id,
      ordinal,
      runId,
      nodeId,
      model: hero.model,
      status: "completed",
      userMessageId,
      startedAt,
      completedAt,
      checkpointId: checkpointId(ordinal),
      checkpointScopeId: workspace.heroScopeId,
    });
    const workAt = new Date(Date.parse(startedAt) + 2_000).toISOString();
    for (const [commandIndex, command] of turn.commands.entries()) {
      insertTurnItem({
        threadId: hero.id,
        runId,
        nodeId,
        ordinal: ordinal * 1_000_000 + 2 + commandIndex,
        startedAt: workAt,
        completedAt: workAt,
        item: {
          type: "command_execution",
          input: command.input,
          output: command.output,
          exitCode: 0,
        },
      });
    }
    const assistantMessageId = `message:${NodeCrypto.randomUUID()}`;
    insertMessage({
      id: assistantMessageId,
      threadId: hero.id,
      runId,
      nodeId,
      role: "assistant",
      text: turn.reply,
      at: completedAt,
    });
    const { ref, files } = workspace.heroCheckpoints[index]!;
    insertTurnItem({
      threadId: hero.id,
      runId,
      nodeId,
      ordinal: ordinal * 1_000_000 + 100,
      startedAt: completedAt,
      completedAt,
      item: {
        type: "assistant_message",
        messageId: assistantMessageId,
        text: turn.reply,
        streaming: false,
      },
    });
    insertTurnItem({
      threadId: hero.id,
      runId,
      nodeId,
      ordinal: ordinal * 1_000_000 + 101,
      startedAt: completedAt,
      completedAt,
      item: {
        type: "checkpoint",
        checkpointId: checkpointId(ordinal),
        scopeId: workspace.heroScopeId,
        files,
      },
    });
    return { runId, nodeId, completedAt, ref, files };
  });

  const scopeCreatedAt = heroTimes[0]!.startedAt;
  insert("orchestration_v2_projection_checkpoint_scopes", {
    scope_id: workspace.heroScopeId,
    thread_id: hero.id,
    run_id: heroRuns.at(-1)!.runId,
    node_id: heroRuns.at(-1)!.nodeId,
    parent_scope_id: null,
    provider_thread_id: null,
    kind: "root_run",
    ordinal_within_parent: 0,
    advances_app_run_count: 1,
    created_at: scopeCreatedAt,
    payload_json: encodePayload(OrchestrationV2CheckpointScopeJson, {
      id: workspace.heroScopeId,
      threadId: hero.id,
      runId: heroRuns.at(-1)!.runId,
      nodeId: heroRuns.at(-1)!.nodeId,
      parentScopeId: null,
      providerThreadId: null,
      kind: "root_run",
      ordinalWithinParent: 0,
      advancesAppRunCount: true,
      cwd: heroWorktree,
      createdAt: scopeCreatedAt,
    }),
  });
  const baseline = {
    runId: null,
    nodeId: heroRuns[0]!.nodeId,
    completedAt: scopeCreatedAt,
    ref: checkpointRef(workspace.heroScopeId, 0),
    files: [],
  };
  for (const [ordinal, checkpoint] of [baseline, ...heroRuns].entries()) {
    insert("orchestration_v2_projection_checkpoints", {
      checkpoint_id: checkpointId(ordinal),
      thread_id: hero.id,
      scope_id: workspace.heroScopeId,
      run_id: checkpoint.runId,
      node_id: checkpoint.nodeId,
      parent_checkpoint_id: ordinal === 0 ? null : checkpointId(ordinal - 1),
      ordinal_within_scope: ordinal,
      app_run_ordinal: ordinal === 0 ? null : ordinal,
      status: "ready",
      captured_at: checkpoint.completedAt,
      payload_json: encodePayload(OrchestrationV2CheckpointJson, {
        id: checkpointId(ordinal),
        threadId: hero.id,
        scopeId: workspace.heroScopeId,
        runId: checkpoint.runId,
        nodeId: checkpoint.nodeId,
        parentCheckpointId: ordinal === 0 ? null : checkpointId(ordinal - 1),
        ordinalWithinScope: ordinal,
        appRunOrdinal: ordinal === 0 ? null : ordinal,
        ref: checkpoint.ref,
        status: "ready",
        files: checkpoint.files,
        capturedAt: checkpoint.completedAt,
      }),
    });
  }

  const insertSidebarThread = (thread: SceneSidebarThread, done: boolean) => {
    const id = NodeCrypto.randomUUID();
    const at = isoMinutesAgo(thread.minutesAgo);
    insertThread({
      id,
      project: thread.project,
      title: thread.title,
      model: thread.model,
      branch: thread.branch,
      worktreePath: done ? null : workspace.worktreeFor(thread),
      createdAt: isoMinutesAgo(thread.minutesAgo + 30),
      updatedAt: at,
      done,
      ...(thread.pullRequest ? { pullRequest: thread.pullRequest } : {}),
    });
    if (!thread.live) return;
    const { runId, nodeId } = runIdsFor(id, 1);
    const userMessageId = insertUserTurnStart({
      threadId: id,
      runId,
      nodeId,
      ordinal: 1,
      text: thread.live.prompt,
      at,
    });
    insertRun({
      threadId: id,
      ordinal: 1,
      runId,
      nodeId,
      model: thread.model,
      status: thread.live.state === "running" ? "running" : "waiting",
      userMessageId,
      startedAt: at,
      completedAt: null,
      checkpointId: null,
      checkpointScopeId: null,
    });
    if (thread.live.state !== "approval") return;
    const requestId = `runtime-request:${NodeCrypto.randomUUID()}`;
    const requestedAt = isoMinutesAgo(Math.max(0, thread.minutesAgo - 20));
    insert("orchestration_v2_projection_runtime_requests", {
      runtime_request_id: requestId,
      thread_id: id,
      node_id: nodeId,
      provider_turn_id: null,
      kind: "command",
      status: "pending",
      created_at: requestedAt,
      resolved_at: null,
      payload_json: encodePayload(OrchestrationV2RuntimeRequestJson, {
        id: requestId,
        nodeId,
        providerTurnId: null,
        nativeRequestRef: null,
        kind: "command",
        status: "pending",
        responseCapability: { type: "message" },
        createdAt: requestedAt,
        resolvedAt: null,
      }),
    });
  };
  for (const thread of SIDEBAR_THREADS) insertSidebarThread(thread, false);
  for (const thread of DONE_THREADS) insertSidebarThread(thread, true);
}

function pullRequestLink(title: string, branch: string, pullRequest: ScenePullRequest, at: string) {
  return {
    host: "github.com",
    repository: pullRequest.repository,
    number: pullRequest.number,
    url: `https://github.com/${pullRequest.repository}/pull/${pullRequest.number}`,
    source: "created",
    linkedAt: at,
    snapshot: {
      state: pullRequest.state,
      title,
      headBranch: branch,
      baseBranch: "main",
      isDraft: false,
      updatedAt: at,
      syncedAt: at,
      mergedAt: pullRequest.state === "merged" ? at : null,
      checksState: pullRequest.state === "merged" ? "passing" : "pending",
      mergeability: "mergeable",
    },
    stack: null,
  };
}

async function reservePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = NodeNet.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No port available."));
      server.close(() => resolve(address.port));
    });
  });
}

function waitForOutput(
  child: NodeChildProcess.ChildProcess,
  label: string,
  pattern: RegExp,
): Promise<RegExpExecArray> {
  return new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(
      () => reject(new Error(`${label} printed nothing matching ${pattern} within two minutes.`)),
      120_000,
    );
    child.stdout!.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const match = pattern.exec(output);
      if (!match) return;
      clearTimeout(timeout);
      resolve(match);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`${label} exited with ${code} before it was ready.`));
    });
  });
}

function startServer(
  root: string,
  home: string,
  port: number,
): {
  readonly server: NodeChildProcess.ChildProcess;
  readonly pairingUrl: Promise<string>;
} {
  const env = { ...NodeProcess.env };
  delete env.VITE_DEV_SERVER_URL;

  const server = NodeChildProcess.spawn(
    NodeProcess.execPath,
    [
      SERVER_BIN,
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--base-dir",
      home,
      "--no-browser",
      "--log-level",
      "error",
    ],
    { cwd: root, env, stdio: ["ignore", "pipe", "inherit"] },
  );
  const pairingUrl = waitForOutput(server, "Server", /Pairing URL: (\S+)/).then(
    (match) => match[1]!,
  );
  return { server, pairingUrl };
}

function buildWebClient(): Promise<void> {
  return run("vp", ["run", "--filter", "@supaterm/web", "build"], {
    ...NodeProcess.env,
    VITE_HTTP_URL: "",
    VITE_WS_URL: "",
    VITE_HOSTED_APP_CHANNEL: "",
    VITE_DEV_SERVER_URL: "",
    SUPATERM_WEB_SOURCEMAP: "0",
  });
}

async function stopServer(server: NodeChildProcess.ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolve) => server.once("exit", resolve));
  server.kill("SIGTERM");
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
}

function issuePairingCredential(home: string): string {
  const output = NodeChildProcess.execFileSync(
    NodeProcess.execPath,
    [SERVER_BIN, "auth", "pairing", "create", "--base-dir", home, "--json"],
    { cwd: REPO_ROOT, encoding: "utf8", env: { ...NodeProcess.env, NO_COLOR: "1" } },
  );
  const parsed = JSON.parse(output.slice(output.indexOf("{"), output.lastIndexOf("}") + 1)) as {
    credential?: unknown;
  };
  if (typeof parsed.credential !== "string")
    throw new Error("Pairing command returned no credential.");
  return parsed.credential;
}

function installChromium(): Promise<void> {
  const require = NodeModule.createRequire(import.meta.url);
  const cli = NodePath.join(
    NodePath.dirname(require.resolve("playwright-core/package.json")),
    "cli.js",
  );
  return run(NodeProcess.execPath, [cli, "install", "chromium"]);
}

async function capture(page: Page, pairingUrl: string, environmentId: string): Promise<Buffer> {
  const origin = new URL(pairingUrl).origin;
  await page.goto(pairingUrl);
  await page.waitForURL((url) => !url.pathname.startsWith("/pair"));
  await page.goto(`${origin}/${environmentId}/${HERO_THREAD.id}`);

  const lastReplyLine = HERO_THREAD.turns.at(-1)!.reply.trim().split("\n").at(-1)!;
  await page.getByText(lastReplyLine, { exact: true }).waitFor();

  await page.getByRole("button", { name: "Open diff" }).last().click();
  await page.getByText("Latest turn", { exact: true }).waitFor();

  const nextFrames = () =>
    page.evaluate(
      "new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
    );
  await page.setViewportSize({ ...VIEWPORT, width: VIEWPORT.width + 1 });
  await nextFrames();
  await page.setViewportSize(VIEWPORT);
  await nextFrames();

  const fileHeader = page.locator("diffs-container", {
    has: page.locator("bdi", { hasText: HERO_THREAD.diffFile }),
  });
  await fileHeader.locator(":scope > [slot=header-prefix] button").click();
  await fileHeader.locator("[data-line]").first().waitFor();

  await page
    .locator("button[aria-expanded=false]", {
      hasText: NodePath.posix.dirname(HERO_THREAD.diffFile),
    })
    .last()
    .click();
  await page
    .getByText(NodePath.posix.basename(HERO_THREAD.diffFile), { exact: true })
    .last()
    .waitFor();

  await page.addStyleTag({ content: '[data-slot="toast-viewport"] { display: none !important; }' });

  await page.mouse.move(700, 25);
  await page.waitForTimeout(500);
  return await page.screenshot({ type: "png" });
}

async function main(): Promise<void> {
  const { values } = NodeUtil.parseArgs({
    options: {
      "skip-build": { type: "boolean", default: false },
      keep: { type: "boolean", default: false },
      out: { type: "string", default: DEFAULT_OUTPUT },
    },
  });

  if (!values["skip-build"]) await buildWebClient();
  await installChromium();

  const root = await NodeFSP.realpath(
    await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "supaterm-marketing-hero-")),
  );
  const home = NodePath.join(root, "home");
  const workspace = await createWorkspace(root);
  const port = await reservePort();
  const { server, pairingUrl } = startServer(root, home, port);
  const browser = await chromium.launch().catch(async (error: unknown) => {
    await stopServer(server);
    throw error;
  });
  try {
    const startupPairingUrl = await pairingUrl;
    const environmentId = (
      await NodeFSP.readFile(NodePath.join(home, "userdata", "environment-id"), "utf8")
    ).trim();

    const db = new NodeSqlite.DatabaseSync(NodePath.join(home, "userdata", "statev2.sqlite"), {
      timeout: 5_000,
    });
    db.exec("BEGIN");
    seed(db, workspace);
    db.exec("COMMIT");
    db.close();

    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      colorScheme: "dark",
    });
    const png = await capture(await context.newPage(), startupPairingUrl, environmentId);

    const pngPath = NodePath.join(NodeOS.tmpdir(), "supaterm-marketing-hero.png");
    await NodeFSP.writeFile(pngPath, png);
    await sharp(png).webp({ quality: 90, effort: 6, smartSubsample: true }).toFile(values.out);
    NodeProcess.stdout.write(
      `Wrote ${NodePath.relative(REPO_ROOT, values.out)} (PNG: ${pngPath})\n`,
    );

    if (values.keep) {
      await browser.close();
      NodeProcess.stdout.write(
        `Server left running at http://127.0.0.1:${port}/${environmentId}/${HERO_THREAD.id}\n` +
          `Pair a browser with http://127.0.0.1:${port}/pair#token=${issuePairingCredential(home)}\n` +
          `State is in ${root}. Press Ctrl-C to stop.\n`,
      );

      await new Promise<never>(() => {});
    }
  } finally {
    await browser.close();
    await stopServer(server);
    if (!values.keep) await NodeFSP.rm(root, { recursive: true, force: true }).catch(() => {});
  }
}

await main();
