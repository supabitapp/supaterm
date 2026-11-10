import type { EnvironmentShellSummary } from "@supaterm/client-runtime/state/shell";
import {
  BearerConnectionProfile,
  BearerConnectionTarget,
} from "@supaterm/client-runtime/connection";
import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";

import { isAwaitingWorkspaceProjects, projectWorkspaceState } from "./workspaceModel";
import { projectEnvironmentConnectionSummary as projectWorkspaceEnvironment } from "@supaterm/client-runtime/state/presentation";
import type { EnvironmentPresentation } from "./environments";

const ENVIRONMENT_ID = EnvironmentId.make("environment-1");

function environment(
  phase: EnvironmentPresentation["connection"]["phase"],
  error: string | null = null,
) {
  const connectionId = `bearer:${ENVIRONMENT_ID}`;
  const presentation: EnvironmentPresentation = {
    environmentId: ENVIRONMENT_ID,
    label: "Julius's MacBook Pro",
    displayUrl: "https://environment.example.test",
    entry: {
      target: new BearerConnectionTarget({
        environmentId: ENVIRONMENT_ID,
        label: "Julius's MacBook Pro",
        connectionId,
      }),
      profile: Option.some(
        new BearerConnectionProfile({
          connectionId,
          environmentId: ENVIRONMENT_ID,
          label: "Julius's MacBook Pro",
          httpBaseUrl: "https://environment.example.test",
          wsBaseUrl: "wss://environment.example.test",
        }),
      ),
      enabled: true,
    },
    connection: {
      phase,
      error,
      traceId: error === null ? null : "trace-1",
    },
    serverConfig: null,
  };
  return projectWorkspaceEnvironment(ENVIRONMENT_ID, presentation);
}

const EMPTY_SHELL_SUMMARY: EnvironmentShellSummary = {
  hasSnapshot: false,
  hasSynchronizingShell: false,
  firstError: null,
};

const LOADING_SHELL_SUMMARY: EnvironmentShellSummary = {
  ...EMPTY_SHELL_SUMMARY,
  hasSynchronizingShell: true,
};

const CACHED_SHELL_SUMMARY: EnvironmentShellSummary = {
  ...LOADING_SHELL_SUMMARY,
  hasSnapshot: true,
};

const READY = {
  isReady: true,
  networkStatus: "online",
  shellSummary: EMPTY_SHELL_SUMMARY,
  hasSyncingConnectedEnvironment: false,
} as const;

const reconnecting = environment("reconnecting");
const failing = environment("reconnecting", "Could not reach the environment.");

describe("mobile workspace projection", () => {
  it.each([
    {
      name: "waits for the saved environments before reading anything else",
      input: { ...READY, isReady: false, environments: [] },
      phase: { type: "loading-catalog", offline: false },
      connectionState: "available",
      awaitingProjects: true,
    },
    {
      name: "reports a device without environments, online or not",
      input: { ...READY, networkStatus: "offline", environments: [] },
      phase: { type: "no-environments", offline: true },
      connectionState: "available",
      awaitingProjects: false,
    },
    {
      name: "reports offline before stale connected presentations",
      input: { ...READY, networkStatus: "offline", environments: [environment("connected")] },
      phase: { type: "unavailable", reason: "offline", error: null, shell: "none" },
      connectionState: "offline",
      awaitingProjects: false,
    },
    {
      name: "still awaits projects offline while an environment is trying unfailed",
      input: { ...READY, networkStatus: "offline", environments: [reconnecting] },
      phase: { type: "unavailable", reason: "offline", error: null, shell: "none" },
      connectionState: "offline",
      awaitingProjects: true,
    },
    {
      name: "carries the failure of an environment that cannot be used",
      input: { ...READY, environments: [environment("unsupported", "Update the app.")] },
      phase: {
        type: "unavailable",
        reason: "unsupported",
        error: "Update the app.",
        shell: "none",
      },
      connectionState: "unsupported",
      awaitingProjects: false,
    },
    {
      name: "keeps retained snapshots visible while reconnecting without claiming readiness",
      input: { ...READY, environments: [reconnecting], shellSummary: CACHED_SHELL_SUMMARY },
      phase: { type: "connecting", environments: [reconnecting], error: null, shell: "syncing" },
      connectionState: "reconnecting",
      awaitingProjects: false,
    },
    {
      name: "keeps connecting while an environment without a snapshot retries after a failure",
      input: { ...READY, environments: [failing] },
      phase: {
        type: "connecting",
        environments: [failing],
        error: "Could not reach the environment.",
        shell: "none",
      },
      connectionState: "reconnecting",
      awaitingProjects: false,
    },
    {
      name: "awaits projects while an environment without a snapshot connects unfailed",
      input: { ...READY, environments: [reconnecting], shellSummary: LOADING_SHELL_SUMMARY },
      phase: { type: "connecting", environments: [reconnecting], error: null, shell: "loading" },
      connectionState: "reconnecting",
      awaitingProjects: true,
    },
    {
      name: "loads the first shell snapshot of a connected environment",
      input: {
        ...READY,
        environments: [environment("connected")],
        shellSummary: LOADING_SHELL_SUMMARY,
        hasSyncingConnectedEnvironment: true,
      },
      phase: { type: "connected", shell: "loading" },
      connectionState: "connected",
      awaitingProjects: true,
    },
    {
      name: "awaits projects of an environment still connecting beside a connected one",
      input: { ...READY, environments: [environment("connected"), reconnecting] },
      phase: { type: "connected", shell: "none" },
      connectionState: "connected",
      awaitingProjects: true,
    },
    {
      name: "ignores another environment's shell sync once one is connected",
      input: {
        ...READY,
        environments: [environment("connected"), failing],
        shellSummary: CACHED_SHELL_SUMMARY,
      },
      phase: { type: "connected", shell: "loaded" },
      connectionState: "connected",
      awaitingProjects: false,
    },
  ] as const)("$name", ({ input, phase, connectionState, awaitingProjects }) => {
    const state = projectWorkspaceState(input);

    expect(state.phase).toEqual(phase);
    expect(state.connectionState).toBe(connectionState);
    expect(isAwaitingWorkspaceProjects(state)).toBe(awaitingProjects);
  });
});
