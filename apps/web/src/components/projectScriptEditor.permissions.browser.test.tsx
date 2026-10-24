import { act, render, type Screen } from "../../test/render";
import {
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  EnvironmentId,
  type AuthEnvironmentScope,
} from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { describe, expect, it, vi } from "vite-plus/test";

const permissions = vi.hoisted(() => ({
  canWriteSettings: false,
  canEditProject: true,
  listeners: new Set<() => void>(),
}));

vi.mock(import("~/state/session"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  const read = (scope: AuthEnvironmentScope) =>
    scope === AuthOrchestrationOperateScope
      ? permissions.canEditProject
      : permissions.canWriteSettings;
  return {
    ...(await original()),
    readEnvironmentScope: (_id: EnvironmentId, scope: AuthEnvironmentScope) => read(scope),
    useEnvironmentScope: (_id: EnvironmentId | null, scope: AuthEnvironmentScope) =>
      useSyncExternalStore(
        (listener) => {
          permissions.listeners.add(listener);
          return () => permissions.listeners.delete(listener);
        },
        () => read(scope),
      ),
  };
});

/** A grant change that React has already rendered, unlike a bare assignment. */
const publish = () => act(async () => permissions.listeners.forEach((listener) => listener()));
import { pressAgain, pressTwice } from "~/test/inlineConfirm";
import { ProjectScriptEditorDialog, type ProjectScriptEditorRequest } from "./projectScriptEditor";

const request: ProjectScriptEditorRequest = {
  scriptId: "test",
  initial: {
    name: "Test",
    command: "vp test",
    icon: "test",
    runOnWorktreeCreate: false,
    waitForSetup: false,
    runOnDone: false,
    keybinding: "mod+k",
    previewUrl: null,
    autoOpenPreview: false,
  },
};

describe("ProjectScriptEditorDialog", () => {
  function setup() {
    permissions.canWriteSettings = false;
    permissions.canEditProject = true;
    permissions.listeners.clear();
  }

  async function openEditor(
    screen: Screen,
    onSubmit = vi.fn().mockResolvedValue(AsyncResult.success(undefined)),
    editorRequest = request,
    actions = { onDelete: vi.fn(), onClose: vi.fn() },
    editScope:
      | typeof AuthOrchestrationOperateScope
      | typeof AuthSettingsWriteScope = AuthOrchestrationOperateScope,
  ) {
    await screen.rerender(
      <ProjectScriptEditorDialog
        environmentId={EnvironmentId.make("script-editor-test")}
        editScope={editScope}
        request={editorRequest}
        scripts={[]}
        onSubmit={onSubmit}
        onDelete={actions.onDelete}
        onClose={actions.onClose}
      />,
    );
  }

  const deleteButton = () =>
    [...document.querySelectorAll("button")].find(
      (element) => element.textContent === "DeleteConfirm delete",
    )!;

  it("rechecks project access before deleting from an already armed confirmation", async () => {
    setup();
    await using screen = await render(null);
    const actions = { onDelete: vi.fn(), onClose: vi.fn() };
    await openEditor(screen, undefined, request, actions);
    await act(async () => deleteButton().click());

    permissions.canEditProject = false;
    await pressAgain(deleteButton());
    expect(actions.onDelete).not.toHaveBeenCalled();
    expect(actions.onClose).not.toHaveBeenCalled();

    permissions.canEditProject = true;
    await publish();
    await pressTwice(deleteButton());
    expect(actions.onDelete).toHaveBeenCalledExactlyOnceWith(request.scriptId);
    expect(actions.onClose).toHaveBeenCalledOnce();
  });
});
