import type { AtomCommand } from "@supaterm/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  EnvironmentId,
} from "@supaterm/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { assert, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => {
  const state = {
    allowed: new Set<string>(),
    pendingReceipts: [] as Array<Promise<unknown>>,
    runs: vi.fn<(target: unknown) => void>(),
    readScope: (environmentId: string, scope: string) =>
      scope === AuthOrchestrationOperateScope && state.allowed.has(environmentId),
    run: (target: unknown) => {
      state.runs(target);
      return state.pendingReceipts.shift() ?? Promise.resolve(AsyncResult.success("receipt"));
    },
  };
  return state;
});

vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("./session", () => ({ readEnvironmentScope: state.readScope }));
vi.mock("./use-atom-command", () => ({ useAtomCommand: () => state.run }));

import { useOrchestrationCommand } from "./use-orchestration-command";

const first = EnvironmentId.make("primary");
const second = EnvironmentId.make("secondary");
type Target = { environmentId: EnvironmentId; input: { threadId: string } };
const command: AtomCommand<Target, string, Error> = {
  label: "thread mutation",
  run: async (_registry, input) => {
    state.runs(input);
    return AsyncResult.success("receipt");
  },
};
const target = (environmentId: EnvironmentId): Target => ({
  environmentId,
  input: { threadId: "thread-1" },
});

beforeEach(() => {
  state.allowed.clear();
  state.pendingReceipts.length = 0;
  state.runs.mockReset();
});

it("checks the command's environment instead of borrowing the primary grant", async () => {
  state.allowed.add(first);
  const mutate = useOrchestrationCommand(command, { reportFailure: false });
  const result = await mutate(target(second));
  assert(result._tag === "Failure");
  const error = Cause.squash(result.cause);
  expect(error).toBeInstanceOf(EnvironmentAuthorizationError);
  expect(error).toMatchObject({ requiredScope: AuthOrchestrationOperateScope });
  expect(state.runs).not.toHaveBeenCalled();

  expect(await mutate(target(first))).toMatchObject({ _tag: "Success", value: "receipt" });
  expect(state.runs).toHaveBeenCalledWith(target(first));
});

it("does not dispatch a later mutation after access changes while awaiting a receipt", async () => {
  state.allowed.add(second);
  let finish: (() => void) | undefined;
  state.pendingReceipts.push(
    new Promise((resolve) => {
      finish = () => resolve(AsyncResult.success("first receipt"));
    }),
  );
  const mutate = useOrchestrationCommand(command);
  const pending = mutate(target(second));
  state.allowed.delete(second);
  finish!();
  expect((await pending)._tag).toBe("Success");
  expect((await mutate(target(second)))._tag).toBe("Failure");
  expect(state.runs).toHaveBeenCalledTimes(1);
});
