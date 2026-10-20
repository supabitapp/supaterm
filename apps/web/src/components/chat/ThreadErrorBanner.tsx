import type { OrchestrationV2ProviderFailureClass } from "@supaterm/contracts";
import { memo, useState } from "react";
import { usePresence } from "~/hooks/usePresence";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { OpenAI } from "../Icons";
import { ChatGptUsageButton } from "../settings/ChatGptUsageButton";
import { ExpandableText } from "../settings/ExpandableText";

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
  chatGptUsageLimit = false,
}: {
  error: string | null;
  errorClass?: OrchestrationV2ProviderFailureClass | null;
  onDismiss?: () => void;
  chatGptUsageLimit?: boolean;
}) {
  const nextBanner = error ? { error, errorClass, chatGptUsageLimit } : null;
  // usePresence retains by identity, so the banner object changes only with its content.
  const [liveBanner, setLiveBanner] = useState(nextBanner);
  if (
    liveBanner?.error !== nextBanner?.error ||
    liveBanner?.errorClass !== nextBanner?.errorClass ||
    liveBanner?.chatGptUsageLimit !== nextBanner?.chatGptUsageLimit
  ) {
    setLiveBanner(nextBanner);
  }
  const presence = usePresence(liveBanner);
  const banner = presence.value;
  if (!banner) return null;
  const variant = banner.errorClass === "usage_limit" ? "warning" : "error";
  return (
    <div
      {...presence.props}
      inert={presence.exiting}
      className="pointer-events-auto mx-auto w-fit max-w-[min(48rem,calc(100%-2rem))] pt-3 transition-[translate] duration-200 ease-drawer data-enter:starting:-translate-y-1 data-ending-style:-translate-y-1 data-ending-style:duration-150 data-ending-style:ease-in motion-reduce:transition-none"
    >
      <Alert variant={variant} surface="glass" controlAlignment="first-line" data-variant={variant}>
        {banner.chatGptUsageLimit ? (
          <OpenAI className="size-4 text-foreground!" aria-hidden="true" />
        ) : (
          <CircleAlertIcon />
        )}
        <AlertDescription>
          {banner.chatGptUsageLimit ? (
            <div className="space-y-1">
              <p className="font-medium">ChatGPT usage limit reached</p>
              <p>Review your usage settings in ChatGPT to continue.</p>
            </div>
          ) : (
            <ExpandableText
              text={banner.error}
              collapsedText={getThreadErrorBannerMessage(banner.error)}
            />
          )}
        </AlertDescription>
        {(banner.chatGptUsageLimit || onDismiss) && (
          <AlertAction>
            {banner.chatGptUsageLimit ? <ChatGptUsageButton variant="default" size="sm" /> : null}
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
