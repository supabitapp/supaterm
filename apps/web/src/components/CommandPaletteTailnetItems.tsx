import { AuthAccessWriteScope } from "@supaterm/contracts";
import { CopyIcon, NetworkIcon, PowerIcon } from "@supaterm/icons";
import { useNavigate } from "@tanstack/react-router";

import { writeTextToClipboard } from "../hooks/useCopyToClipboard";
import { useUpdateEnvironmentSettings } from "../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { ITEM_ICON_CLASS, type CommandPaletteActionItem } from "./CommandPalette.logic";
import { useTailnetView } from "./settings/useTailnetView";

/** Built-in Tailscale actions for the primary environment. */
export function useCommandPaletteTailnetItems(): ReadonlyArray<CommandPaletteActionItem> {
  const environmentId = usePrimaryEnvironmentId();
  const tailnet = useTailnetView(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const navigate = useNavigate();
  if (tailnet === null) return [];
  const { view, settings } = tailnet;
  const items: CommandPaletteActionItem[] = [];
  if (view.kind !== "loading" && view.kind !== "unavailable" && view.kind !== "running") {
    items.push({
      kind: "action",
      value: "action:tailnet:set-up",
      title: "Set up built-in Tailscale",
      searchTerms: ["tailscale", "tailnet", "headscale", "remote", "vpn", "sign in"],
      icon: <NetworkIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await navigate({
          to: "/settings/access",
          hash: "built-in-tailscale",
          hashScrollIntoView: false,
        });
      },
    });
  }
  if (view.kind === "running" && view.address !== null) {
    const { address } = view;
    items.push({
      kind: "action",
      value: "action:tailnet:copy-address",
      title: "Copy Tailscale address",
      description: view.dnsName,
      searchTerms: ["tailscale", "tailnet", "address", "url", "copy", "ts.net"],
      icon: <CopyIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        await writeTextToClipboard(address, "Tailscale address");
      },
    });
  }
  if (settings.enabled && canWrite) {
    items.push({
      kind: "action",
      value: "action:tailnet:turn-off",
      title: "Turn off built-in Tailscale",
      searchTerms: ["tailscale", "tailnet", "disable", "stop", "off"],
      icon: <PowerIcon className={ITEM_ICON_CLASS} />,
      run: async () => {
        updateSettings({ tailnet: { enabled: false } });
      },
    });
  }
  return items;
}
