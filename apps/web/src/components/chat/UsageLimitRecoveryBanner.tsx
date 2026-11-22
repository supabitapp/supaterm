import {
  type OrchestrationV2LimitRecovery,
  type OrchestrationV2LimitRecoveryUpdate,
  type RunId,
} from "@supaterm/contracts";
import { GaugeIcon } from "@supaterm/icons";
import { type TimestampFormat } from "@supaterm/contracts/settings";
import { deadlineStore } from "@supaterm/client-runtime/clock";
import { limitRecoveryOwnsSnooze } from "@supaterm/client-runtime/state/thread-execution";
import {
  CHATGPT_USAGE_LIMIT_CODE,
  CHATGPT_WORKSPACE_USAGE_LIMIT_CODE,
} from "@supaterm/shared/usageLimits";
import { useState } from "react";
import { useDeadlinePassed } from "../../hooks/useDeadline";
import { OpenAI } from "../Icons";
import { ChatGptUsageButton } from "../settings/ChatGptUsageButton";
import { Button, InlineButton } from "../ui/button";
import { formatUpcomingTimestamp } from "../../timestampFormat";
import { toastManager } from "../ui/toast";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";
import { copyAdminRequest } from "./ThreadErrorBanner";

type RecoveryProps = {
  runId: RunId;
  errorCode: string | null;
  resetAt: string | null;
  stoppedAt: string;
  done: boolean;
  requestPending: boolean;
  snoozedUntil: string | null;
  recovery: OrchestrationV2LimitRecovery | null;
  timestampFormat: TimestampFormat;
  resetPassed?: boolean;
  displayPassed?: boolean;
  onChange: (recovery: OrchestrationV2LimitRecoveryUpdate) => Promise<void>;
};

function parseEpochMs(isoDate: string | null): number | null {
  if (isoDate === null) return null;
  const parsed = Date.parse(isoDate);
  return Number.isFinite(parsed) ? parsed : null;
}

function limitRecoveryScheduleState(
  props: Pick<
    RecoveryProps,
    "runId" | "resetAt" | "stoppedAt" | "done" | "requestPending" | "recovery" | "snoozedUntil"
  >,
) {
  // The server refuses recovery changes while a request is pending.
  const canSchedule =
    !props.done &&
    !props.requestPending &&
    props.resetAt !== null &&
    Date.parse(props.resetAt) > Date.parse(props.stoppedAt);
  const resumes =
    canSchedule &&
    props.recovery?.runId === props.runId &&
    props.recovery.resetAt === props.resetAt &&
    props.recovery.autoResume;
  const displayAt =
    resumes &&
    props.resetAt &&
    props.snoozedUntil &&
    Date.parse(props.snoozedUntil) > Date.parse(props.resetAt)
      ? props.snoozedUntil
      : props.resetAt;
  return { canSchedule, resumes, displayAt };
}

export function useUsageLimitRecoveryBannerItem(
  props: RecoveryProps | null,
): ComposerBannerStackItem | null {
  const displayAt = props === null ? null : limitRecoveryScheduleState(props).displayAt;
  const resetPassed = useDeadlinePassed(props === null ? null : parseEpochMs(props.resetAt));
  const displayPassed = useDeadlinePassed(parseEpochMs(displayAt));
  if (props === null) return null;
  return usageLimitRecoveryBannerItem({ ...props, resetPassed, displayPassed });
}

export function usageLimitRecoveryBannerItem(props: RecoveryProps): ComposerBannerStackItem {
  const { runId, errorCode, resetAt, timestampFormat } = props;
  const { canSchedule, resumes, displayAt } = limitRecoveryScheduleState(props);
  const resetAtMs = parseEpochMs(resetAt);
  const displayAtMs = parseEpochMs(displayAt);
  const resetPassed = props.resetPassed ?? (resetAtMs !== null && resetAtMs <= Date.now());
  const displayPassed = props.displayPassed ?? (displayAtMs !== null && displayAtMs <= Date.now());
  const workspaceLimit = errorCode === CHATGPT_WORKSPACE_USAGE_LIMIT_CODE;
  const chatGptLimit = workspaceLimit || errorCode === CHATGPT_USAGE_LIMIT_CODE;
  const recoveryActions = canSchedule ? (
    <RecoveryActions key={`${runId}:${resetAt}`} {...props} />
  ) : null;
  const resumesUpcoming = resumes && !displayPassed;
  const shownAt = resumesUpcoming ? displayAt : resetAt;
  const resetDescription = shownAt
    ? `${resumesUpcoming ? "Resumes" : resetPassed ? "Reset" : "Resets"} ${formatUpcomingTimestamp(shownAt, timestampFormat)}`
    : "Reset time unavailable; retry manually";
  if (!chatGptLimit) {
    return {
      id: `usage-limit-recovery:${runId}`,
      variant: "warning",
      priority: "urgent",
      alwaysVisible: true,
      icon: <GaugeIcon />,
      title: "Usage limit reached",
      description: resetDescription,
      actions: recoveryActions,
    };
  }
  // OpenAI's partner guidelines specify this ChatGPT notice and its actions.
  return {
    id: `usage-limit-recovery:${runId}`,
    variant: "warning",
    priority: "urgent",
    alwaysVisible: true,
    icon: <OpenAI aria-hidden="true" />,
    title: "ChatGPT usage limit reached",
    description: workspaceLimit
      ? "You've reached your workspace's limit for using your ChatGPT plan in other apps."
      : resetDescription,
    actions: (
      <>
        {recoveryActions}
        {workspaceLimit ? (
          <Button size="xs" variant="ghost" onClick={copyAdminRequest}>
            Copy request for admin
          </Button>
        ) : (
          <ChatGptUsageButton size="xs" variant="ghost" />
        )}
      </>
    ),
  };
}

function RecoveryActions({ runId, resetAt, recovery, snoozedUntil, onChange }: RecoveryProps) {
  const [pending, setPending] = useState(false);

  const scheduled =
    recovery?.runId === runId && recovery.resetAt === resetAt && recovery.autoResume;
  // The server leaves snoozedUntil in place after the timer wakes the thread,
  // so a snooze whose reset has passed is no longer active.
  const resetPassed = useDeadlinePassed(resetAt === null ? null : Date.parse(resetAt));
  const snoozed =
    limitRecoveryOwnsSnooze({ runId, resetAt, recovery, snoozedUntil }) && !resetPassed;
  async function toggle(action: "resume" | "snooze") {
    if (resetAt === null) return;
    if (action === "snooze" && !snoozed && Date.parse(resetAt) <= Date.now()) {
      toastManager.add({
        type: "error",
        title: "Could not snooze thread",
        description: "The reset time has passed. Retry the thread manually.",
      });
      // The deadline timer can lag after a throttled tab or sleep; disable now.
      deadlineStore(Date.parse(resetAt)).refresh();
      return;
    }
    setPending(true);
    try {
      await onChange({
        runId,
        resetAt,
        ...(action === "resume" ? { autoResume: !scheduled } : { snooze: !snoozed }),
      });
    } catch (cause) {
      toastManager.add({
        type: "error",
        title: action === "resume" ? "Could not change auto-resume" : "Could not snooze thread",
        description: cause instanceof Error ? cause.message : "An error occurred.",
      });
    }
    setPending(false);
  }

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
      <InlineButton touchTarget="padded" disabled={pending} onClick={() => void toggle("resume")}>
        {pending
          ? "Saving..."
          : scheduled
            ? "Cancel auto-resume"
            : resetPassed
              ? "Resume now"
              : "Resume at reset"}
      </InlineButton>
      <InlineButton
        touchTarget="padded"
        disabled={pending || (!snoozed && resetPassed)}
        onClick={() => void toggle("snooze")}
      >
        {pending ? "Saving..." : snoozed ? "Wake now" : "Snooze until reset"}
      </InlineButton>
    </span>
  );
}
