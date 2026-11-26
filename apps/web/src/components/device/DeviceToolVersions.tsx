import type { ReactNode } from "react";
import type { DeviceToolVersions as ToolVersions } from "@supaterm/contracts";
import { InlineButton } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "~/components/ui/popover";
import { msg, T, useGT } from "gt-react";

export function DeviceToolVersions({
  tools,
  action,
  kind,
  owner,
  error,
}: {
  tools: ToolVersions | undefined;
  action?: ReactNode;
  kind?: keyof ToolVersions;
  owner?: string | undefined;
  error?: string | undefined;
}) {
  const gt = useGT();
  const selected = kind ? tools?.[kind] : undefined;
  const version =
    selected?.runningVersion ??
    (selected?.installedVersions.includes(selected.requiredVersion)
      ? selected.requiredVersion
      : selected?.installedVersions
          .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          .at(-1));
  const label = kind === "hub" ? "Device hub" : "Agent device";
  return (
    <Popover>
      <PopoverTrigger
        aria-label={
          kind
            ? `${label}: ${version ? `version ${version}` : selected ? "not installed" : "version unknown"}. Show details`
            : undefined
        }
        render={<InlineButton tone="muted" />}
      >
        {kind
          ? version
            ? `v${version}`
            : selected
              ? gt("Not installed")
              : gt("Version unknown")
          : error
            ? gt("Versions unavailable")
            : gt("Versions")}
      </PopoverTrigger>
      <PopoverPopup align="end" width="md">
        <PopoverTitle>{kind ? label : gt("Device tools")}</PopoverTitle>
        {tools ? (
          <div className="mt-4 divide-y divide-border/50">
            {(
              [
                [msg("Device hub"), tools.hub],
                [msg("Agent device"), tools.agent],
              ] as const
            ).flatMap(([name, tool]) =>
              !kind || name === label
                ? [
                    <div key={name} className="space-y-2 py-3 first:pt-0 last:pb-0">
                      {!kind ? <p className="text-xs font-medium">{name}</p> : null}
                      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-xs">
                        <dt className="text-muted-foreground">
                          <T context="running tool version">Running</T>
                        </dt>
                        <dd className="text-right font-mono">
                          {tool.runningVersion ?? gt("Not running")}
                        </dd>
                        <dt className="text-muted-foreground">
                          <T context="required tool version">Required</T>
                        </dt>
                        <dd className="text-right font-mono">{tool.requiredVersion}</dd>
                        <dt className="text-muted-foreground">
                          <T context="installed tool versions">Installed</T>
                        </dt>
                        <dd className="text-right font-mono break-words">
                          {tool.installedVersions.join(", ") ||
                            gt("None", { $context: "no versions" })}
                        </dd>
                      </dl>
                    </div>,
                  ]
                : [],
            )}
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            <T>Versions have not been checked.</T>
          </p>
        )}
        <p className="mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
          {owner ? `Managed by ${owner}. ` : ""}Tools update automatically on this host when needed.
        </p>
        {error ? (
          <p role="status" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        ) : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </PopoverPopup>
    </Popover>
  );
}
