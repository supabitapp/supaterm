import { connectionAddressLabel } from "@supaterm/client-runtime/connection";
import type { DesktopSshEnvironmentTarget, EnvironmentMachineKind } from "@supaterm/contracts";
import * as Option from "effect/Option";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import type { EnvironmentPresentation } from "~/state/environments";
import { isDesktopLocalConnectionTarget } from "~/connection/desktopLocal";
import { EnvironmentMachineIcon } from "../EnvironmentMachineIcon";

export function formatDesktopSshTarget(target: DesktopSshEnvironmentTarget): string {
  const authority = target.username ? `${target.username}@${target.hostname}` : target.hostname;
  return target.port ? `${authority}:${target.port}` : authority;
}

/**
 * How this client reaches a machine, printed first in every environment row so
 * SSH, WSL, and plain remote links are told apart without a legend.
 */
export function environmentTransportLabel(environment: EnvironmentPresentation): string {
  const { entry } = environment;
  if (entry.target._tag === "PrimaryConnectionTarget") return "This machine";
  if (isDesktopLocalConnectionTarget(entry.target)) return "WSL";
  if (
    entry.target._tag === "SshConnectionTarget" &&
    Option.isSome(entry.profile) &&
    entry.profile.value._tag === "SshConnectionProfile"
  ) {
    return `SSH ${formatDesktopSshTarget(entry.profile.value.target)}`;
  }
  return environment.displayUrl === null
    ? "Remote link"
    : connectionAddressLabel(environment.displayUrl);
}

export function EnvironmentRow({
  kind,
  label,
  status,
  subtitle,
  below,
  detail,
  dimmed = false,
  className,
  children,
}: {
  readonly kind: EnvironmentMachineKind;
  readonly label: string;
  readonly status?: ReactNode;
  readonly subtitle: ReactNode;
  readonly below?: ReactNode;
  /** Optional full-width detail content rendered below the row. */
  readonly detail?: ReactNode;
  readonly dimmed?: boolean;
  readonly className?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-3 py-2.5 sm:px-4",
        className,
      )}
    >
      <EnvironmentMachineIcon
        aria-hidden
        kind={kind}
        className={cn("size-4 text-muted-foreground", dimmed && "opacity-60")}
      />
      <div className={cn("min-w-0", dimmed && "opacity-60")}>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <p className="min-w-0 truncate text-sm font-medium text-foreground">{label}</p>
          {status}
        </div>
        <div className="min-w-0 truncate text-xs text-muted-foreground">{subtitle}</div>
        {below}
      </div>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
      {detail ? <div className="col-span-3 min-w-0">{detail}</div> : null}
    </div>
  );
}
