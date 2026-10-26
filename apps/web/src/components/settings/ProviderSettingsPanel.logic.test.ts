import {
  AuthProvidersManageScope,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ServerSettings,
  DEFAULT_SERVER_SETTINGS,
} from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildProviderInstanceOverridePatch,
  resolveProjectProviderOverride,
  resolvePrimaryOperateAccess,
  resolveRemoteOperateAccess,
} from "./ProviderSettingsPanel.logic";

describe("primary operate access", () => {
  it("denies unauthenticated sessions and sessions without the operate scope", () => {
    expect(
      resolvePrimaryOperateAccess({
        isPrimary: true,
        hasDesktopBridge: false,
        session: { authenticated: false },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
    expect(
      resolvePrimaryOperateAccess({
        isPrimary: true,
        hasDesktopBridge: false,
        session: { authenticated: true, scopes: ["orchestration:read"] },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
    expect(
      resolvePrimaryOperateAccess({
        isPrimary: true,
        hasDesktopBridge: false,
        session: null,
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
  });
});

describe("buildProviderInstanceOverridePatch", () => {
  const projectId = ProjectId.make("project-a");
  const instanceId = ProviderInstanceId.make("codex_work");

  it("reports differing checkout values and finds overrides beyond the first checkout", () => {
    const siblingId = ProjectId.make("project-a-worktree");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: { driver: ProviderDriverKind.make("codex"), enabled: true, config: {} },
      },
      projectSettingsOverrides: {
        [siblingId]: { providerInstances: { [instanceId]: { enabled: false } } },
      },
    };
    expect(resolveProjectProviderOverride(settings, [projectId, siblingId], instanceId)).toEqual({
      value: undefined,
      valueMixed: true,
      hasOverride: true,
      effectiveEnabled: true,
      mixed: true,
    });
    const reset = {
      ...settings,
      projectSettingsOverrides: buildProviderInstanceOverridePatch(
        settings,
        [projectId, siblingId],
        instanceId,
        undefined,
      ),
    };
    expect(reset.projectSettingsOverrides).toEqual({ [projectId]: null, [siblingId]: null });
  });

  it("writes the same choice to every checkout of the project", () => {
    const siblingId = ProjectId.make("project-a-worktree");
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [siblingId]: { newWorktreesStartFromOrigin: true },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId, siblingId], instanceId, false),
    ).toEqual({
      [projectId]: { providerInstances: { [instanceId]: { enabled: false } } },
      [siblingId]: {
        newWorktreesStartFromOrigin: true,
        providerInstances: { [instanceId]: { enabled: false } },
      },
    });
  });

  it("resets the only override by clearing the whole project entry", () => {
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [projectId]: { providerInstances: { [instanceId]: { enabled: true } } },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId], instanceId, undefined),
    ).toEqual({ [projectId]: null });
  });

  it("sends providerInstances: {} explicitly when clearing the last instance override leaves other keys", () => {
    const settings: Pick<ServerSettings, "projectSettingsOverrides"> = {
      projectSettingsOverrides: {
        [projectId]: {
          newWorktreesStartFromOrigin: true,
          providerInstances: { [instanceId]: { enabled: true } },
        },
      },
    };

    expect(
      buildProviderInstanceOverridePatch(settings, [projectId], instanceId, undefined),
    ).toEqual({
      [projectId]: { newWorktreesStartFromOrigin: true, providerInstances: {} },
    });
  });
});

describe("remote operate access", () => {
  it("does not treat the old orchestration grant as provider management", () => {
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: ["orchestration:operate"] },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
  });

  it("derives access from the environment session's granted scopes", () => {
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: [AuthProvidersManageScope] },
        isPending: false,
        hasError: false,
      }),
    ).toBe("granted");
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: true, scopes: ["orchestration:read"] },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
    expect(
      resolveRemoteOperateAccess({
        session: { authenticated: false },
        isPending: false,
        hasError: false,
      }),
    ).toBe("denied");
  });
});
