import type { ContextMenuItem } from "@supaterm/contracts";
import {
  type SourceControlDefinition,
  UNKNOWN_SOURCE_CONTROL_CLIENT,
} from "@supaterm/client-runtime/source-control-clients";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";

import { toastManager } from "../ui/toast";

export type PullRequestLinkContextMenuAction = "copy-link" | "open-external" | "show-linked";

export const openOnHostLabel = (host: SourceControlDefinition, number?: number): string => {
  const verb = number === undefined ? "Open" : `Open #${number}`;
  return host === UNKNOWN_SOURCE_CONTROL_CLIENT ? `${verb} on host` : `${verb} on ${host.label}`;
};

function pullRequestLinkContextMenuItems({
  host,
  number,
  showLinked,
}: {
  readonly host: SourceControlDefinition;
  readonly number: number | undefined;
  readonly showLinked: boolean;
}): readonly ContextMenuItem<PullRequestLinkContextMenuAction>[] {
  const items: ContextMenuItem<PullRequestLinkContextMenuAction>[] = [
    {
      id: "copy-link",
      label: number === undefined ? "Copy link" : `Copy link to #${number}`,
      icon: "copy",
    },
    { id: "open-external", label: openOnHostLabel(host, number) },
  ];
  if (showLinked) {
    items.push({ id: "show-linked", label: "Show linked pull requests", separatorBefore: true });
  }
  return items;
}

export async function showPullRequestLinkContextMenu({
  url,
  host,
  position,
  number,
  onShowLinked,
}: {
  readonly url: string;
  readonly host: SourceControlDefinition;
  readonly position: { readonly x: number; readonly y: number };
  /** Names the pull request in the labels, for triggers that do not show which one they mean. */
  readonly number?: number | undefined;
  readonly onShowLinked?: (() => void) | undefined;
}): Promise<void> {
  const api = readLocalApi();
  if (!api) return;
  const items = pullRequestLinkContextMenuItems({
    host,
    number,
    showLinked: onShowLinked !== undefined,
  });
  let action: PullRequestLinkContextMenuAction | null = null;
  try {
    action = await api.contextMenu.show(items, position);
  } catch {
    return;
  }
  if (action === "show-linked") {
    onShowLinked?.();
    return;
  }
  try {
    if (action === "copy-link") await writeTextToClipboard(url, "link");
    else if (action === "open-external") await api.shell.openExternal(url);
  } catch {
    toastManager.add({
      type: "error",
      title: action === "copy-link" ? "Could not copy the link" : "Could not open the link",
    });
  }
}
