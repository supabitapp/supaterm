import { CommonActions } from "@react-navigation/native";

import { selectWorkspaceDetail } from "../layout/workspace/workspace-detail-selection";
import type { readStartNewTaskDestination } from "./use-start-new-task";

export function startNewTaskAction(
  destination: Awaited<ReturnType<typeof readStartNewTaskDestination>>,
) {
  return destination === null
    ? CommonActions.navigate("NewTaskProject")
    : selectWorkspaceDetail({ name: "Thread", params: destination });
}
