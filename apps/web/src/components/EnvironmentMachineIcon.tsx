import type { EnvironmentMachineKind } from "@supaterm/contracts";
import { CloudIcon, type IconProps, LaptopIcon, MonitorIcon, ServerIcon } from "@supaterm/icons";
import { useId, type FunctionComponent, type SVGProps } from "react";
import { LinuxIcon } from "./Icons";

// Read once per renderer, not per icon: long environment lists do no native IPC work.
const nativeMachineIcons =
  typeof window === "undefined" ? {} : (window.desktopBridge?.getEnvironmentMachineIcons?.() ?? {});

// SVG fallbacks follow Lucide's 24 unit grid and prop surface so every client
// can draw Apple hardware even when native symbols are unavailable.
function LucideLike(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

/** An alpha mask lets the native glyph inherit the same tint as every other icon. */
function NativeMachineIcon({ source, ...props }: SVGProps<SVGSVGElement> & { source: string }) {
  const maskId = useId();
  return (
    <LucideLike {...props}>
      <defs>
        <mask id={maskId} style={{ maskType: "alpha" }}>
          <image href={source} width="24" height="24" />
        </mask>
      </defs>
      <rect width="24" height="24" fill="currentColor" stroke="none" mask={`url(#${maskId})`} />
    </LucideLike>
  );
}

function MacMiniIcon(props: SVGProps<SVGSVGElement>) {
  if (nativeMachineIcons["mac-mini"]) {
    return <NativeMachineIcon source={nativeMachineIcons["mac-mini"]} {...props} />;
  }
  return (
    <LucideLike {...props}>
      <rect width="20" height="8" x="2" y="8" rx="2" />
      <path d="M6 12h.01" />
    </LucideLike>
  );
}

function MacStudioIcon(props: SVGProps<SVGSVGElement>) {
  if (nativeMachineIcons["mac-studio"]) {
    return <NativeMachineIcon source={nativeMachineIcons["mac-studio"]} {...props} />;
  }
  return (
    <LucideLike {...props}>
      <rect width="18" height="14" x="3" y="5" rx="2" />
      <path d="M7 15h.01M11 15h.01M15 15h.01" />
    </LucideLike>
  );
}

const ICON_BY_KIND: Record<EnvironmentMachineKind, FunctionComponent<IconProps>> = {
  server: ServerIcon,
  cloud: CloudIcon,
  linux: LinuxIcon,
  desktop: MonitorIcon,
  laptop: LaptopIcon,
  "mac-mini": MacMiniIcon,
  "mac-studio": MacStudioIcon,
};

export const ENVIRONMENT_MACHINE_KIND_LABELS: Record<EnvironmentMachineKind, string> = {
  server: "Server",
  cloud: "Cloud VM",
  linux: "Linux/WSL",
  desktop: "Desktop",
  laptop: "Laptop",
  "mac-mini": "Mac mini",
  "mac-studio": "Mac Studio",
};

export function environmentMachineIcon(kind: EnvironmentMachineKind): FunctionComponent<IconProps> {
  return ICON_BY_KIND[kind];
}

export function EnvironmentMachineIcon({
  kind,
  ...props
}: IconProps & { readonly kind: EnvironmentMachineKind }) {
  const Icon = ICON_BY_KIND[kind];
  return <Icon {...props} />;
}
