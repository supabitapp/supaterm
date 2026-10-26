import type { ContextMenuItem } from "@supaterm/contracts";
import {
  type SourceControlClientDefinition,
  UNKNOWN_SOURCE_CONTROL_CLIENT,
} from "@supaterm/client-runtime/source-control-clients";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";

import { toastManager } from "../ui/toast";

export type PullRequestLinkContextMenuAction = "copy-link" | "open-external" | "show-linked";

export const openOnHostLabel = (host: SourceControlClientDefinition, number?: number): string => {
  const verb = number === undefined ? "Open" : `Open #${number}`;
  return host === UNKNOWN_SOURCE_CONTROL_CLIENT ? `${verb} on host` : `${verb} on ${host.label}`;
};

function pullRequestLinkContextMenuItems({
  hasUrl,
  host,
  number,
  showLinked,
}: {
  readonly hasUrl: boolean;
  readonly host: SourceControlClientDefinition;
  readonly number: number | undefined;
  readonly showLinked: boolean;
}): readonly ContextMenuItem<PullRequestLinkContextMenuAction>[] {
  const items: ContextMenuItem<PullRequestLinkContextMenuAction>[] = hasUrl
    ? [
        {
          id: "copy-link",
          label: number === undefined ? "Copy link" : `Copy link to #${number}`,
          icon: "copy",
        },
        { id: "open-external", label: openOnHostLabel(host, number) },
      ]
    : [];
  if (showLinked) {
    items.push({
      id: "show-linked",
      label: "Show linked pull requests",
      separatorBefore: items.length > 0,
    });
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
  readonly url: string | undefined;
  readonly host: SourceControlClientDefinition;
  readonly position: { readonly x: number; readonly y: number };
  /** Names the pull request in the labels, for triggers that do not show which one they mean. */
  readonly number?: number | undefined;
  readonly onShowLinked?: (() => void) | undefined;
}): Promise<void> {
  const api = readLocalApi();
  if (!api) return;
  const items = pullRequestLinkContextMenuItems({
    hasUrl: url !== undefined,
    host,
    number,
    showLinked: onShowLinked !== undefined,
  });
  if (items.length === 0) return;
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
  if (url === undefined) return;
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
