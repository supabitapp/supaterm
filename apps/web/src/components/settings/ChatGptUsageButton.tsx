import type { ComponentProps } from "react";
import { ExternalLinkIcon } from "@supaterm/icons";
import { CHATGPT_USAGE_URL } from "@supaterm/shared/usageLimits";
import { ensureLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import { T } from "gt-react";

export function ChatGptUsageButton(props: Omit<ComponentProps<typeof Button>, "onClick">) {
  return (
    <Button
      variant="ghost-muted"
      size="sm"
      {...props}
      onClick={() => void ensureLocalApi().shell.openExternal(CHATGPT_USAGE_URL)}
    >
      <T>Manage usage</T>
      <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
    </Button>
  );
}
