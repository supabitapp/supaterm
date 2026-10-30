import { EnvironmentId } from "@supaterm/contracts";
import { expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  offered: false,
  allowed: false,
  queries: vi.fn(),
  list: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => state.offered }));
vi.mock("../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@supaterm/client-runtime/state/peerLinks", () => ({
  createPeerLinkEnvironmentAtoms: () => ({ list: state.list }),
}));
vi.mock("./presentation", () => ({ environmentPresentations: {} }));
vi.mock("./environments", () => ({
  useEnvironmentIdentities: () => [{ environmentId: "linked", label: "Saved name" }],
}));
vi.mock("./session", () => ({ useEnvironmentScope: () => state.allowed }));
vi.mock("./query", () => ({
  useEnvironmentQuery: (query: unknown) => {
    state.queries(query);
    return { data: { links: [{ environmentId: "linked", label: "Old name", status: "ready" }] } };
  },
}));

import { useLinkedEnvironments } from "./peerLinks";

it("never reads links with the feature disabled and hides cached links after permission revocation", () => {
  const id = EnvironmentId.make("destination");
  state.list.mockClear();
  state.offered = false;
  state.allowed = true;
  expect(useLinkedEnvironments(id).size).toBe(0);
  expect(state.list).not.toHaveBeenCalled();
  expect(state.queries).toHaveBeenLastCalledWith(null);

  state.offered = true;
  state.list.mockReturnValue("destination-query");
  expect([...useLinkedEnvironments(id)]).toEqual([["linked", "Saved name"]]);
  expect(state.list).toHaveBeenCalledWith({ environmentId: id, input: {} });

  state.list.mockClear();
  state.allowed = false;
  expect(useLinkedEnvironments(id).size).toBe(0);
  expect(state.list).not.toHaveBeenCalled();
  expect(state.queries).toHaveBeenLastCalledWith(null);
});
