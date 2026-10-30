import { createContext, type ReactElement, type ReactNode } from "react";

export const WorkspacePresentationHostContext = createContext(false);
export const WorkspaceColumnsRendererContext = createContext<
  ((children: ReactNode) => ReactElement) | null
>(null);
