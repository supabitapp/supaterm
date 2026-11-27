/// <reference lib="dom" />
// A linked thread opens as a right-panel tab of a thread on the linking environment. This saves
// the tab that opening one leaves, for `browser.addInitScript` to restore before the app loads.

/** Mirror of RIGHT_PANEL_STORAGE_KEY and RIGHT_PANEL_STORAGE_VERSION in apps/web/src/rightPanelStore.ts. */
const RIGHT_PANEL_STORAGE = { key: "supaterm:right-panel-state:v2", version: 14 };

type LinkedThreadTab = {
  readonly via: string;
  readonly linked: string;
  readonly parentId: string;
  readonly childId: string;
  readonly title: string;
};

/** The init script's argument: the tab and where the panel keeps it. */
export const linkedThreadTab = (tab: LinkedThreadTab) => ({ ...tab, storage: RIGHT_PANEL_STORAGE });

/** Runs in the page: opens the parent thread's panel on the linked thread's tab. */
export function restoreLinkedThreadTab({
  via,
  linked,
  parentId,
  childId,
  title,
  storage,
}: ReturnType<typeof linkedThreadTab>) {
  if (location.pathname !== `/${via}/${parentId}`) return;
  const id = `linked-thread:${encodeURIComponent(via)}:${encodeURIComponent(linked)}:${encodeURIComponent(childId)}`;
  localStorage.setItem(
    storage.key,
    JSON.stringify({
      version: storage.version,
      state: {
        byThreadKey: {
          [`${via}:${parentId}`]: {
            isOpen: true,
            activeSurfaceId: id,
            surfaces: [
              {
                kind: "linked-thread",
                id,
                viaEnvironmentId: via,
                environmentId: linked,
                threadId: childId,
                label: "Scenario",
                title,
              },
            ],
          },
        },
        threadPanelVisibilityByThreadKey: {},
      },
    }),
  );
}
