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
    preferenceFailure: null as "read" | "write" | null,
    run: vi.fn<(input: unknown) => void>(),
    getPreference: vi.fn<(...args: ReadonlyArray<unknown>) => void>(),
    setPreference: vi.fn<(...args: ReadonlyArray<unknown>) => void>(),
    runCommand: async (input: unknown) => {
      state.run(input);
      return AsyncResult.success(undefined);
    },
    readPreference: (...args: ReadonlyArray<unknown>) => {
      state.getPreference(...args);
      if (state.preferenceFailure === "read") {
        state.preferenceFailure = null;
        throw new Error("Preference storage unavailable");
      }
      return null;
    },
    writePreference: (...args: ReadonlyArray<unknown>) => {
      state.setPreference(...args);
      if (state.preferenceFailure === "write") {
        state.preferenceFailure = null;
        throw new Error("Preference storage unavailable");
      }
    },
  };
  return state;
});

vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("./state/shell", () => ({ shellEnvironment: { openInEditor: "openInEditor" } }));
vi.mock("./state/use-atom-command", () => ({ useAtomCommand: () => state.runCommand }));
vi.mock("./state/session", () => ({
  readEnvironmentScope: (environmentId: string, scope: string) =>
    scope === AuthOrchestrationOperateScope && state.allowed.has(environmentId),
}));
vi.mock("./hooks/useLocalStorage", () => ({
  getLocalStorageItem: state.readPreference,
  setLocalStorageItem: state.writePreference,
  useLocalStorage: vi.fn(),
}));

import { useOpenInPreferredEditor } from "./editorPreferences";

const primary = EnvironmentId.make("primary");
const secondary = EnvironmentId.make("secondary");

beforeEach(() => {
  state.allowed.clear();
  state.preferenceFailure = null;
  state.run.mockReset();
  state.getPreference.mockReset();
  state.setPreference.mockReset();
});

it("does not use another environment's grant or change preferences when denied", async () => {
  state.allowed.add(primary);
  const open = useOpenInPreferredEditor(secondary, ["vscode"]);
  const result = await open("/work/readme.md");
  assert(result._tag === "Failure");
  const error = Cause.squash(result.cause);
  expect(error).toBeInstanceOf(EnvironmentAuthorizationError);
  expect(error).toMatchObject({ requiredScope: AuthOrchestrationOperateScope });
  expect(state.run).not.toHaveBeenCalled();
  expect(state.getPreference).not.toHaveBeenCalled();
  expect(state.setPreference).not.toHaveBeenCalled();
});

it("checks revocation and regrant when a retained editor callback is invoked", async () => {
  state.allowed.add(secondary);
  const open = useOpenInPreferredEditor(secondary, ["vscode"]);
  state.allowed.delete(secondary);
  expect((await open("/work/readme.md:5"))._tag).toBe("Failure");
  expect(state.run).not.toHaveBeenCalled();

  state.allowed.add(secondary);
  expect(await open("/work/readme.md:5")).toMatchObject({ _tag: "Success", value: "vscode" });
  expect(state.run).toHaveBeenCalledExactlyOnceWith({
    environmentId: secondary,
    input: { cwd: "/work/readme.md:5", editor: "vscode" },
  });
  expect(state.setPreference).toHaveBeenCalledTimes(1);
});

it.each(["read", "write"] as const)(
  "opens an available editor when its preference %s fails",
  async (operation) => {
    state.allowed.add(secondary);
    state.preferenceFailure = operation;
    const open = useOpenInPreferredEditor(secondary, ["vscode"]);
    await expect(open("/work/readme.md:5")).resolves.toMatchObject({
      _tag: "Success",
      value: "vscode",
    });
    expect(state.run).toHaveBeenCalledExactlyOnceWith({
      environmentId: secondary,
      input: { cwd: "/work/readme.md:5", editor: "vscode" },
    });
  },
);

it.each([
  ["file:///work/read%20me.md", "/work/read me.md", {}],
  [
    "file://foreign/share/read%20me.md:12#L5",
    String.raw`\\foreign\share\read me.md:12`,
    { line: 5 },
  ],
  ["file:///work/report.txt:12", "/work/report.txt:12", {}],
  ["file:///work/report.txt:12#L5C3", "/work/report.txt:12", { line: 5, column: 3 }],
])(
  "sends a plain exact path for %s to compatible and older servers",
  async (uri, cwd, position) => {
    state.allowed.add(secondary);
    const open = useOpenInPreferredEditor(secondary, ["vscode"]);
    await open(uri);
    expect(state.run).toHaveBeenCalledExactlyOnceWith({
      environmentId: secondary,
      input: { cwd, position, editor: "vscode" },
    });
  },
);
