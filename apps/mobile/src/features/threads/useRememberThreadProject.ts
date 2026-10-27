import { useFocusEffect } from "@react-navigation/native";
import { isScratchProject } from "@supaterm/client-runtime/state/projects";
import type { EnvironmentProject } from "@supaterm/client-runtime/state/shell";
import { useCallback } from "react";

import { useEnvironmentServerConfig } from "../../state/entities";
import { setStickyNewTaskProject } from "../../state/use-composer-drafts";

/** A focused thread's project becomes the one the next new thread starts in. */
export function useRememberThreadProject(project: EnvironmentProject | null) {
  const serverConfig = useEnvironmentServerConfig(project?.environmentId ?? null);
  const environmentId = project?.environmentId;
  const projectId = project?.id;
  const remember =
    project !== null &&
    serverConfig !== null &&
    !isScratchProject(project, serverConfig.scratchWorkspaceRoot);

  useFocusEffect(
    useCallback(() => {
      if (!remember || !environmentId || !projectId) return;
      setStickyNewTaskProject({ environmentId, projectId });
    }, [environmentId, projectId, remember]),
  );
}
