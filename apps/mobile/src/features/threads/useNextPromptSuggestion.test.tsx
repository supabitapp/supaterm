import { EnvironmentId, RunId, ThreadId } from "@supaterm/contracts";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { useNextPromptSuggestion } from "./useNextPromptSuggestion";

const { suggest } = vi.hoisted(() => ({ suggest: vi.fn() }));
vi.mock("../../state/orchestration", async () => {
  const { Atom } = await import("effect/reactivity");
  const permission = Atom.make(true);
  return { orchestrationEnvironment: { suggestNextPrompt: { permissionAtom: () => permission } } };
});
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => suggest }));

let renderer: ReactTestRenderer | undefined;
const input = {
  environmentId: EnvironmentId.make("first"),
  threadId: ThreadId.make("thread"),
  connected: true,
  enabled: true,
  latestRun: {
    runId: RunId.make("run"),
    status: "completed" as const,
    requestedAt: "2026-10-29T12:00:00.000Z",
    startedAt: "2026-10-29T12:00:01.000Z",
    completedAt: "2026-10-29T12:00:02.000Z",
    assistantMessageId: null,
  },
};

function Probe(props: Parameters<typeof useNextPromptSuggestion>[0]) {
  return useNextPromptSuggestion(props);
}

async function render(props = input) {
  await act(() => {
    if (renderer) renderer.update(<Probe {...props} />);
    else renderer = create(<Probe {...props} />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  suggest.mockReset();
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

it("keeps suggestions scoped to the environment and ignores obsolete answers", async () => {
  const first = Promise.withResolvers<{ _tag: "Success"; value: { suggestion: string } }>();
  const second = Promise.withResolvers<{ _tag: "Success"; value: { suggestion: string } }>();
  suggest.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  await render();
  await render({ ...input, environmentId: EnvironmentId.make("second") });
  await act(() => first.resolve({ _tag: "Success", value: { suggestion: "obsolete" } }));
  expect(renderer?.toJSON()).toBeNull();

  await act(() => second.resolve({ _tag: "Success", value: { suggestion: "continue" } }));
  expect(renderer?.toJSON()).toBe("continue");
  await render({ ...input, environmentId: EnvironmentId.make("second") });
  expect(suggest).toHaveBeenCalledTimes(2);
});

it("waits for connectivity and hides suggestions when disabled", async () => {
  suggest.mockResolvedValue({ _tag: "Success", value: { suggestion: "continue" } });
  await render({ ...input, connected: false });
  expect(suggest).not.toHaveBeenCalled();
  expect(renderer?.toJSON()).toBeNull();
  await render();
  expect(renderer?.toJSON()).toBe("continue");
  await render({ ...input, enabled: false });
  expect(renderer?.toJSON()).toBeNull();
  expect(suggest).toHaveBeenCalledTimes(1);
});
