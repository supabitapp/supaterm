import { EnvironmentId, ThreadId } from "@supaterm/contracts";
import { useNavigation } from "@react-navigation/native";
import { useAdaptiveWorkspaceLayout } from "../layout/adaptive-workspace-context";
import { startOpeningEnvironmentThread } from "../../state/threads";
import {
  selectWorkspaceDetail,
  type WorkspaceDetail,
  type WorkspaceDetailSheet,
} from "./workspace-detail-selection";

const first = (value: string | readonly string[] | undefined) =>
  typeof value === "string" ? value : value?.[0];

export function startOpeningDetail(detail: WorkspaceDetail) {
  if (detail.name !== "Thread") return;
  const environmentId = first(detail.params?.environmentId);
  const threadId = first(detail.params?.threadId);
  if (environmentId && threadId) {
    startOpeningEnvironmentThread(EnvironmentId.make(environmentId), ThreadId.make(threadId));
  }
}

export function useSelectWorkspaceDetail() {
  const navigation = useNavigation();
  const { selectDetail } = useAdaptiveWorkspaceLayout();
  return (
    selectDetail ??
    ((detail: WorkspaceDetail, sheet?: WorkspaceDetailSheet) => {
      startOpeningDetail(detail);
      navigation.dispatch(selectWorkspaceDetail(detail, sheet));
    })
  );
}
