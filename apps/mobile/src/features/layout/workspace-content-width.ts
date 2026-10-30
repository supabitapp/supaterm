import { createContext, use } from "react";
import type { SharedValue } from "react-native-reanimated";

export const WorkspaceContentWidthContext = createContext<SharedValue<number> | null>(null);

export function useWorkspaceContentWidth() {
  return use(WorkspaceContentWidthContext);
}

export const WorkspaceSettledContentWidthContext = createContext<number | null>(null);

export function useWorkspaceSettledContentWidth() {
  return use(WorkspaceSettledContentWidthContext);
}
