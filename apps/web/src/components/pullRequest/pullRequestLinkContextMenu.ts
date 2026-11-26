import type { ContextMenuItem, ContextMenuSource } from "@supaterm/contracts";
import {
  type SourceControlDefinition,
  UNKNOWN_SOURCE_CONTROL_CLIENT,
} from "@supaterm/client-runtime/source-control-clients";

import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { readLocalApi } from "~/localApi";

import { toastManager } from "../ui/toast";
import { msg } from "gt-react";
import { m, type MessageResolver } from "~/i18n/messages";

export type PullRequestLinkContextMenuAction = "copy-link" | "open-external" | "show-linked";

export const openOnHostLabel = (
  host: SourceControlDefinition,
  number?: number,
  resolve: MessageResolver = m,
): string => {
  if (host === UNKNOWN_SOURCE_CONTROL_CLIENT) {
    return number === undefined
      ? resolve(msg("Open on host"))
      : resolve(msg("Open #{number} on host", { number }));
  }
  return number === undefined
    ? resolve(msg("Open on {host}", { host: host.label }))
    : resolve(msg("Open #{number} on {host}", { number, host: host.label }));
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
      label:
        number === undefined ? m(msg("Copy link")) : m(msg("Copy link to #{number}", { number })),
      icon: "copy",
    },
    { id: "open-external", label: openOnHostLabel(host, number) },
  ];
  if (showLinked) {
    items.push({
      id: "show-linked",
      label: m(msg("Show linked pull requests")),
      separatorBefore: true,
    });
  }
  return items;
}

export async function showPullRequestLinkContextMenu({
  url,
  host,
  position,
  source,
  number,
  onShowLinked,
}: {
  readonly url: string;
  readonly host: SourceControlDefinition;
  readonly position: { readonly x: number; readonly y: number };
  readonly source: ContextMenuSource;
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
    action = await api.contextMenu.show(items, position, source);
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
      title:
        action === "copy-link"
          ? m(msg("Could not copy the link"))
          : m(msg("Could not open the link")),
    });
  }
}
