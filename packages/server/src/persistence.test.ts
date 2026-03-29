import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { StateStore, type PersistedState } from "./persistence.js";

const COMPACT_SESSION_NAME = "sp.aaaaaaaaaaaa.bbbbbbbbbbbb";

test("state store writes Swift-compatible session catalogs", () => {
  const dir = mkdtempSync(join(tmpdir(), "supaterm-state-"));
  const path = join(dir, "sessions.json");
  const store = new StateStore(path);

  const state: PersistedState = {
    workspaces: [{ id: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC", name: "A" }],
    selectedWorkspaceId: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
    tabs: [
      {
        id: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
        workspaceId: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
        title: "Build",
        icon: "hammer",
        isDirty: false,
        isPinned: true,
        isTitleLocked: false,
        tone: "slate",
      },
    ],
    selectedTabId: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
    trees: {
      "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA": {
        root: {
          type: "leaf",
          id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
        },
        zoomed: null,
      },
    },
    focusedPaneByTab: {
      "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA":
        "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
    },
    panes: {
      "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB": {
        id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
        tabId: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
        sessionName: COMPACT_SESSION_NAME,
        title: "shell",
        pwd: "/tmp/project",
        isRunning: true,
        cols: 80,
        rows: 24,
      },
    },
  };

  store.save(state);

  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    defaultSelectedWorkspaceID: { rawValue: string };
    workspaces: Array<{
      id: { rawValue: string };
      selectedTabID: { rawValue: string };
      tabs: Array<{
        id: { rawValue: string };
        selectedPaneID: string;
        splitTree: { root: { leaf: { _0: string } } };
      }>;
    }>;
  };

  expect(raw.defaultSelectedWorkspaceID.rawValue).toBe(
    "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
  );
  expect(raw.workspaces[0]?.id.rawValue).toBe(
    "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
  );
  expect(raw.workspaces[0]?.selectedTabID.rawValue).toBe(
    "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
  );
  expect(raw.workspaces[0]?.tabs[0]?.id.rawValue).toBe(
    "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
  );
  expect(raw.workspaces[0]?.tabs[0]?.selectedPaneID).toBe(
    "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
  );
  expect(raw.workspaces[0]?.tabs[0]?.splitTree.root.leaf._0).toBe(
    "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
  );

  rmSync(dir, { recursive: true, force: true });
});

test("state store loads Swift-compatible session catalogs", () => {
  const dir = mkdtempSync(join(tmpdir(), "supaterm-state-"));
  const path = join(dir, "sessions.json");
  const store = new StateStore(path);

  writeFileSync(
    path,
    JSON.stringify({
      defaultSelectedWorkspaceID: {
        rawValue: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
      },
      workspaces: [
        {
          id: { rawValue: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC" },
          name: "A",
          selectedTabID: { rawValue: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
          tabs: [
            {
              id: { rawValue: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
              title: "Build",
              icon: "hammer",
              isPinned: true,
              isTitleLocked: false,
              selectedPaneID: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
              panes: [
                {
                  id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
                  sessionName: COMPACT_SESSION_NAME,
                  title: "shell",
                  workingDirectoryPath: "/tmp/project",
                  lastKnownRunning: true,
                },
              ],
              splitTree: {
                root: {
                  leaf: { _0: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB" },
                },
              },
            },
          ],
        },
      ],
    }),
  );

  const loaded = store.load();

  expect(loaded?.selectedWorkspaceId).toBe(
    "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
  );
  expect(loaded?.selectedTabId).toBe("AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA");
  expect(loaded?.panes["BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB"]?.sessionName).toBe(
    COMPACT_SESSION_NAME,
  );
  expect(
    loaded?.trees["AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA"]?.root,
  ).toEqual({
    type: "leaf",
    id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
  });

  rmSync(dir, { recursive: true, force: true });
});

test("state store does not overwrite newer external catalog data with a stale snapshot", () => {
  const dir = mkdtempSync(join(tmpdir(), "supaterm-state-"));
  const path = join(dir, "sessions.json");
  const store = new StateStore(path);

  writeFileSync(
    path,
    JSON.stringify({
      defaultSelectedWorkspaceID: {
        rawValue: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
      },
      selectionUpdatedAt: 10,
      workspaces: [
        {
          id: { rawValue: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC" },
          updatedAt: 10,
          name: "A",
          selectedTabID: { rawValue: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
          tabs: [
            {
              id: { rawValue: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
              updatedAt: 10,
              title: "Build",
              icon: null,
              isPinned: false,
              isTitleLocked: false,
              selectedPaneID: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
              panes: [
                {
                  id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
                  sessionName: COMPACT_SESSION_NAME,
                  updatedAt: 10,
                  title: "old",
                  workingDirectoryPath: "/tmp/project",
                  lastKnownRunning: false,
                },
              ],
              splitTree: {
                root: {
                  leaf: { _0: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB" },
                },
              },
            },
          ],
        },
      ],
    }),
  );

  const staleState = store.load();

  writeFileSync(
    path,
    JSON.stringify({
      defaultSelectedWorkspaceID: {
        rawValue: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
      },
      selectionUpdatedAt: 20,
      workspaces: [
        {
          id: { rawValue: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC" },
          updatedAt: 20,
          name: "A",
          selectedTabID: { rawValue: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
          tabs: [
            {
              id: { rawValue: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
              updatedAt: 20,
              title: "Build",
              icon: null,
              isPinned: false,
              isTitleLocked: false,
              selectedPaneID: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
              panes: [
                {
                  id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
                  sessionName: COMPACT_SESSION_NAME,
                  updatedAt: 20,
                  title: "new",
                  workingDirectoryPath: "/tmp/project",
                  lastKnownRunning: false,
                },
              ],
              splitTree: {
                root: {
                  leaf: { _0: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB" },
                },
              },
            },
          ],
        },
      ],
    }),
  );

  store.save(staleState!);

  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    workspaces: Array<{
      tabs: Array<{
        panes: Array<{
          title: string;
          updatedAt: number;
        }>;
      }>;
    }>;
  };

  expect(raw.workspaces[0]?.tabs[0]?.panes[0]?.title).toBe("new");
  expect(raw.workspaces[0]?.tabs[0]?.panes[0]?.updatedAt).toBe(20);

  rmSync(dir, { recursive: true, force: true });
});

test("state store does not resurrect a pane deleted by a newer external catalog", () => {
  const dir = mkdtempSync(join(tmpdir(), "supaterm-state-"));
  const path = join(dir, "sessions.json");
  const store = new StateStore(path);

  writeFileSync(
    path,
    JSON.stringify({
      defaultSelectedWorkspaceID: {
        rawValue: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
      },
      selectionUpdatedAt: 10,
      workspaces: [
        {
          id: { rawValue: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC" },
          updatedAt: 10,
          name: "A",
          selectedTabID: { rawValue: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
          tabs: [
            {
              id: { rawValue: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
              updatedAt: 10,
              title: "Build",
              icon: null,
              isPinned: false,
              isTitleLocked: false,
              selectedPaneID: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
              panes: [
                {
                  id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
                  sessionName: COMPACT_SESSION_NAME,
                  updatedAt: 10,
                  title: "old",
                  workingDirectoryPath: "/tmp/project",
                  lastKnownRunning: false,
                },
              ],
              splitTree: {
                root: {
                  leaf: { _0: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB" },
                },
              },
            },
          ],
        },
      ],
    }),
  );

  const staleState = store.load();

  writeFileSync(
    path,
    JSON.stringify({
      defaultSelectedWorkspaceID: {
        rawValue: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC",
      },
      selectionUpdatedAt: 20,
      workspaces: [
        {
          id: { rawValue: "CCCCCCCC-CCCC-CCCC-CCCC-CCCCCCCCCCCC" },
          updatedAt: 20,
          name: "A",
          selectedTabID: { rawValue: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
          tabs: [
            {
              id: { rawValue: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA" },
              updatedAt: 20,
              title: "Build",
              icon: null,
              isPinned: false,
              isTitleLocked: false,
              selectedPaneID: "CCCCCCCC-DDDD-EEEE-FFFF-000000000000",
              panes: [],
              splitTree: {
                root: null,
              },
            },
          ],
        },
      ],
      paneTombstones: [
        {
          id: "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
          deletedAt: 20,
        },
      ],
    }),
  );

  store.save(staleState!);

  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    paneTombstones?: Array<{ id: string; deletedAt: number }>;
    workspaces: Array<{
      tabs: Array<{
        panes: Array<{ id: string }>;
      }>;
    }>;
  };

  expect(
    raw.workspaces[0]?.tabs[0]?.panes.some(
      (pane) => pane.id === "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB",
    ) ?? false,
  ).toBe(false);
  expect(
    raw.paneTombstones?.some(
      (tombstone) =>
        tombstone.id === "BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB"
        && tombstone.deletedAt === 20,
    ) ?? false,
  ).toBe(true);

  rmSync(dir, { recursive: true, force: true });
});
