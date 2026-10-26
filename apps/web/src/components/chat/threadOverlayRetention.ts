/**
 * Chat overlays (dialogs, media previews) are opened for one thread and must not
 * outlive every route and pane that shows it. Overlay modules register here when
 * they load, so the route listener can drop them without importing the overlays.
 */
const retainers: Array<(shownThreadKeys: ReadonlySet<string>) => void> = [];

export function registerThreadOverlay(
  retain: (shownThreadKeys: ReadonlySet<string>) => void,
): void {
  retainers.push(retain);
}

/** Drops every overlay opened for a thread outside `shownThreadKeys`. */
export function retainThreadOverlaysFor(shownThreadKeys: ReadonlySet<string>): void {
  for (const retain of retainers) retain(shownThreadKeys);
}
