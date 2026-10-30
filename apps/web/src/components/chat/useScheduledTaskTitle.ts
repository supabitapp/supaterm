import type { EnvironmentId, ScheduledTaskId } from "@supaterm/contracts";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";

export function useScheduledTaskTitle(
  environmentId: EnvironmentId,
  scheduledTaskId: ScheduledTaskId | undefined,
) {
  const tasks = useEnvironmentQuery(
    scheduledTaskId ? serverEnvironment.scheduledTasksLive({ environmentId, input: {} }) : null,
  );
  return tasks.data?.tasks.find((task) => task.id === scheduledTaskId)?.title;
}
