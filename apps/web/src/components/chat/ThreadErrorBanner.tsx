import type { OrchestrationV2ProviderFailureClass } from "@supaterm/contracts";
import {
  CHATGPT_USAGE_LIMIT_CODE,
  CHATGPT_WORKSPACE_ADMIN_REQUEST,
  CHATGPT_WORKSPACE_USAGE_LIMIT_CODE,
} from "@supaterm/shared/usageLimits";
import { memo, useState } from "react";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { usePresence } from "~/hooks/usePresence";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { OpenAI } from "../Icons";
import { ChatGptUsageButton } from "../settings/ChatGptUsageButton";
import { ExpandableText } from "../settings/ExpandableText";

function copyAdminRequest() {
  void writeTextToClipboard(CHATGPT_WORKSPACE_ADMIN_REQUEST, "admin request").then(
    () =>
      toastManager.add({
        type: "success",
        title: "Request copied",
        description: "Send it to your workspace admin.",
      }),
    () => toastManager.add({ type: "error", title: "Could not copy the request" }),
  );
}

export function getThreadErrorBannerMessage(error: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(error);
  } catch {
    return error;
  }
  if (typeof payload !== "object" || payload === null || !("error" in payload)) {
    return error;
  }
  const nestedError = payload.error;
  if (typeof nestedError !== "object" || nestedError === null || !("message" in nestedError)) {
    return error;
  }
  return typeof nestedError.message === "string" && nestedError.message.trim().length > 0
    ? nestedError.message
    : error;
}

export function getThreadErrorBannerKey(threadKey: string, error: string | null): string | null {
  return error === null ? null : `${threadKey}\u0000${error}`;
}

export function shouldShowThreadErrorBanner(
  threadKey: string,
  error: string | null,
  isDismissed: boolean,
): boolean {
  return getThreadErrorBannerKey(threadKey, error) !== null && !isDismissed;
}

const sessionDismissedThreadErrorBannerKeys = new Set<string>();

export function dismissThreadErrorBannerForSession(bannerKey: string | null): void {
  if (bannerKey !== null) {
    sessionDismissedThreadErrorBannerKeys.add(bannerKey);
  }
}

export function isThreadErrorBannerDismissedForSession(bannerKey: string | null): boolean {
  return bannerKey !== null && sessionDismissedThreadErrorBannerKeys.has(bannerKey);
}

export const ThreadErrorBanner = memo(function ThreadErrorBanner({
  error,
  onDismiss,
  errorClass,
  errorCode,
}: {
  error: string | null;
  errorClass?: OrchestrationV2ProviderFailureClass | null;
  errorCode?: string | null;
  onDismiss?: () => void;
}) {
  const nextBanner = error ? { error, errorClass, errorCode } : null;
  // usePresence retains by identity, so the banner object changes only with its content.
  const [liveBanner, setLiveBanner] = useState(nextBanner);
  if (
    liveBanner?.error !== nextBanner?.error ||
    liveBanner?.errorClass !== nextBanner?.errorClass ||
    liveBanner?.errorCode !== nextBanner?.errorCode
  ) {
    setLiveBanner(nextBanner);
  }
  const presence = usePresence(liveBanner);
  const banner = presence.value;
  if (!banner) return null;
  const workspaceLimit = banner.errorCode === CHATGPT_WORKSPACE_USAGE_LIMIT_CODE;
  const chatGptLimit = workspaceLimit || banner.errorCode === CHATGPT_USAGE_LIMIT_CODE;
  const variant = banner.errorClass === "usage_limit" || chatGptLimit ? "warning" : "error";
  return (
    <div
      {...presence.props}
      inert={presence.exiting}
      className="pointer-events-auto mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3 transition-[translate] duration-200 ease-drawer data-enter:starting:-translate-y-1 data-ending-style:-translate-y-1 data-ending-style:duration-150 data-ending-style:ease-in motion-reduce:transition-none"
    >
      <Alert variant={variant} surface="glass" controlAlignment="first-line" data-variant={variant}>
        {chatGptLimit ? (
          <OpenAI className="size-4 text-foreground!" aria-hidden="true" />
        ) : (
          <CircleAlertIcon />
        )}
        <AlertDescription>
          {chatGptLimit ? (
            <div className="space-y-1">
              <p className="font-medium">ChatGPT usage limit reached</p>
              <p>
                {workspaceLimit
                  ? "You've reached your workspace's limit for using your ChatGPT plan in other apps. Copy a request to ask your workspace admin for increased usage limits."
                  : "Review your usage settings in ChatGPT."}
              </p>
            </div>
          ) : (
            <ExpandableText
              text={banner.error}
              collapsedText={getThreadErrorBannerMessage(banner.error)}
            />
          )}
        </AlertDescription>
        {(chatGptLimit || onDismiss) && (
          <AlertAction>
            {workspaceLimit ? (
              <Button variant="default" size="sm" onClick={copyAdminRequest}>
                Copy request for admin
              </Button>
            ) : chatGptLimit ? (
              <ChatGptUsageButton variant="default" size="sm" />
            ) : null}
            {onDismiss ? (
              <Button variant="ghost" size="icon-xs" aria-label="Dismiss error" onClick={onDismiss}>
                <XIcon />
              </Button>
            ) : null}
          </AlertAction>
        )}
      </Alert>
    </div>
  );
});
