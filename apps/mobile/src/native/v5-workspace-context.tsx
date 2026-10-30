import { createContext, type ReactNode } from "react";

export const NativeWorkspaceModeContext = createContext(false);

export interface WorkspaceSlotOptions {
  readonly byRoute: ReadonlyMap<string, object>;
  readonly set: (routeKey: string, options: object) => void;
}
export const WorkspaceSlotOptionsContext = createContext<WorkspaceSlotOptions | null>(null);

export function slotScreenOptions<Options extends object>(
  slot: WorkspaceSlotOptions | null,
  routeKey: string | undefined,
  options: Options,
): Options {
  const own = routeKey === undefined ? undefined : slot?.byRoute.get(routeKey);
  return own ? { ...options, ...own } : options;
}

export const NativeWorkspaceTabActivityContext = createContext<{
  readonly active: boolean;
  readonly isActive: () => boolean;
} | null>(null);
export const NativePrimaryColumnContext = createContext<{
  readonly presented: boolean;
  readonly selectedThreadKey: string | null;
  readonly selectedPullRequestKey: string | null;
} | null>(null);
export const NativeWorkspaceInspectorContext = createContext<{
  readonly render: (() => ReactNode) | undefined;
  readonly visible: boolean;
}>({ render: undefined, visible: false });
