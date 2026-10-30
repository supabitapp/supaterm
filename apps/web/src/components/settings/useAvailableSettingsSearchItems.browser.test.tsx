import { AuthAccessReadScope, DEFAULT_SERVER_SETTINGS, EnvironmentId } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

const state = vi.hoisted(() => ({ readable: new Set<string>(["allowed"]) }));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments })) as never,
  usePrimaryEnvironmentId: () => null,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  useEnvironmentScope: () => false,
  useEnvironmentsWithScope: (
    hosts: ReadonlyArray<{ environmentId: EnvironmentId }>,
    scope: string,
  ) => {
    expect(scope).toBe(AuthAccessReadScope);
    return new Set(
      hosts.flatMap((host) => (state.readable.has(host.environmentId) ? [host.environmentId] : [])),
    );
  },
}));
vi.mock(import("~/state/query"), async (original) => ({
  ...(await original()),
  useEnvironmentQuery: (() => ({ data: null, error: null })) as never,
}));

import { usePeerLinkHosts } from "~/state/peerLinks";
import { useAvailableSettingsSearchItems } from "./useAvailableSettingsSearchItems";

const environment = (id: string, connected: boolean, enabled: boolean, supported: boolean) => ({
  environmentId: EnvironmentId.make(id),
  connection: { phase: connected ? "connected" : "disconnected" },
  serverConfig: {
    settings: { ...DEFAULT_SERVER_SETTINGS, linkedEnvironmentsEnabled: enabled },
    environment: { platform: { os: "linux" }, capabilities: { peerLinks: supported } },
  },
});
const environments = [
  environment("allowed", true, true, true),
  environment("denied", true, true, true),
  environment("offline", false, true, true),
  environment("disabled", true, false, true),
  environment("unsupported", true, true, false),
];

function Subject() {
  const hosts = usePeerLinkHosts();
  const items = useAvailableSettingsSearchItems();
  return (
    <>
      <output aria-label="Link hosts">
        {hosts.map((host) => host.environmentId).join(",") || "None"}
      </output>
      <output aria-label="Linked settings available">
        {items.some((item) => item.id === "linked-environments") ? "Yes" : "No"}
      </output>
    </>
  );
}

it("offers linked settings only for supported connected hosts with destination read permission", async () => {
  state.readable = new Set(["allowed", "offline", "disabled", "unsupported"]);
  await using screen = await render(<Subject />);
  await expect.element(screen.getByLabelText("Link hosts")).toHaveTextContent("allowed");
  await expect.element(screen.getByLabelText("Linked settings available")).toHaveTextContent("Yes");

  state.readable = new Set(["offline", "disabled", "unsupported"]);
  await screen.rerender(<Subject />);
  await expect.element(screen.getByLabelText("Link hosts")).toHaveTextContent("None");
  await expect.element(screen.getByLabelText("Linked settings available")).toHaveTextContent("No");

  state.readable.add("allowed");
  await screen.rerender(<Subject />);
  await expect.element(screen.getByLabelText("Linked settings available")).toHaveTextContent("Yes");
});
