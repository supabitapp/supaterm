import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  ProjectId,
  type OrchestrationV2SearchThreadsInput,
  type OrchestrationV2SearchThreadsResult,
} from "@supaterm/contracts";
import { AtomRegistry } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../test/render";

const fixture = vi.hoisted(() => ({
  requests: [] as Array<{ environmentId: string; input: OrchestrationV2SearchThreadsInput }>,
  older: [] as Array<OrchestrationV2SearchThreadsInput>,
  mounted: [] as Array<string>,
  released: [] as Array<string>,
}));
vi.mock("../rpc/atomRegistry", async () => {
  const { AtomRegistry } = await import("effect/reactivity");
  return { appAtomRegistry: AtomRegistry.make() };
});
vi.mock("./orchestration", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  return {
    orchestrationEnvironment: {
      threadSearch: (target: {
        environmentId: string;
        input: OrchestrationV2SearchThreadsInput;
      }) => {
        fixture.requests.push(target);
        return Atom.make(AsyncResult.success({ matches: [] }));
      },
    },
  };
});
vi.mock("./threads", async () => {
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const old = Atom.make({ before: "2026-10-01T00:00:00.000Z" });
  const current = Atom.make(null);
  return {
    olderSettledThreads: {
      olderSettledAtom: (environmentId: string) => (environmentId === "older" ? old : current),
      searchAtom: (_environmentId: string, input: OrchestrationV2SearchThreadsInput) => {
        fixture.older.push(input);
        return Atom.make(
          AsyncResult.success({
            matches: [],
            threads: [],
            snapshotSequence: 9,
          } satisfies OrchestrationV2SearchThreadsResult),
        );
      },
    },
    threadFamilies: {
      mountRows: (_registry: unknown, environmentId: string) => {
        fixture.mounted.push(environmentId);
        return () => fixture.released.push(environmentId);
      },
    },
  };
});
vi.mock("./projects", () => ({ projectEnvironment: {}, projectContentSearch: vi.fn() }));
vi.mock("./vcs", () => ({ vcsEnvironment: {} }));
vi.mock("./filesystem", () => ({ useFilesystemReadAccess: vi.fn() }));

import { useThreadSearch } from "./queries";

function resetFixture() {
  fixture.requests.length = 0;
  fixture.older.length = 0;
  fixture.mounted.length = 0;
  fixture.released.length = 0;
}

it("passes complete scoped input to the search families and mounts rows until the search closes", async () => {
  resetFixture();
  const registry = AtomRegistry.make();
  using disposers = new DisposableStack();
  disposers.defer(() => registry.dispose());
  const projectId = ProjectId.make("project");
  function Search() {
    const result = useThreadSearch(
      [EnvironmentId.make("live"), EnvironmentId.make("older")],
      "needle",
      { projectIds: [projectId], environmentLabels: { older: "Remote" } },
    );
    return <span>{result.query}</span>;
  }
  await using screen = await render(
    <RegistryContext.Provider value={registry}>
      <Search />
    </RegistryContext.Provider>,
    { router: false },
  );
  await expect.element(screen.getByText("needle", { exact: true })).toBeInTheDocument();
  expect(fixture.requests).toEqual([{ environmentId: "live", input: { query: "needle" } }]);
  expect(fixture.older).toEqual([
    {
      query: "needle",
      olderSettledBefore: "2026-10-01T00:00:00.000Z",
      projectIds: [projectId],
      environmentLabel: "Remote",
    },
  ]);
  expect(fixture.mounted.toSorted()).toEqual(["live", "older"]);
  await screen.unmount();
  expect(fixture.released.toSorted()).toEqual(["live", "older"]);
});

it("loads short title-only mentions from the older shelf without issuing a message search", async () => {
  resetFixture();
  const registry = AtomRegistry.make();
  using disposers = new DisposableStack();
  disposers.defer(() => registry.dispose());
  function MentionSearch() {
    const result = useThreadSearch([EnvironmentId.make("older")], "ab", { titlesOnly: true });
    return <span>{result.query}</span>;
  }
  await using screen = await render(
    <RegistryContext.Provider value={registry}>
      <MentionSearch />
    </RegistryContext.Provider>,
    { router: false },
  );
  await expect.element(screen.getByText("ab", { exact: true })).toBeInTheDocument();
  expect(fixture.requests).toEqual([]);
  expect(fixture.older).toEqual([
    { query: "ab", olderSettledBefore: "2026-10-01T00:00:00.000Z", titlesOnly: true },
  ]);
});
