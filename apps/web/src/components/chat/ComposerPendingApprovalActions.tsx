import {
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
  type RuntimeRequestId,
} from "@supaterm/contracts";
import { memo } from "react";
import { EllipsisIcon, TriangleAlertIcon } from "@supaterm/icons";
import { Button, InlineButton } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { composerFloatingLayerProps } from "./composerEventScope";
import { useGT, msg } from "gt-react";

interface ComposerPendingApprovalActionsProps {
  presentation?: "composer" | "inline";
  requestId: RuntimeRequestId;
  isResponding: boolean;
  canRespond: boolean;
  disabled?: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  onRespondToApproval: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

const DEFAULT_APPROVAL_OPTIONS = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: msg("Always allow this session") },
  { decision: "accept", label: "Approve" },
] satisfies ReadonlyArray<ProviderApprovalOption>;

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  presentation = "composer",
  requestId,
  isResponding,
  canRespond,
  disabled = false,
  options = DEFAULT_APPROVAL_OPTIONS,
  onRespondToApproval,
}: ComposerPendingApprovalActionsProps) {
  const gt = useGT();
  const primaryOptions = options.filter(
    (option) => option.decision === "decline" || option.decision === "accept",
  );
  const moreOptions = options.filter(
    (option) => option.decision !== "decline" && option.decision !== "accept",
  );
  const unavailable = disabled || isResponding || !canRespond;

  return (
    <>
      {primaryOptions.map((option) => {
        const buttonProps = {
          disabled: unavailable,
          "aria-description": option.warning,
          onClick: () => {
            if (!unavailable) {
              void onRespondToApproval(requestId, option.decision);
            }
          },
        };
        const content = (
          <>
            {option.warning ? <TriangleAlertIcon className="size-3 shrink-0" /> : null}
            <span className={presentation === "inline" ? "whitespace-normal" : "max-w-40 truncate"}>
              {option.label}
            </span>
          </>
        );
        const button =
          presentation === "inline" ? (
            <InlineButton
              key={option.decision}
              {...buttonProps}
              tone={option.decision === "accept" ? "default" : "muted"}
            >
              {content}
            </InlineButton>
          ) : (
            <Button
              key={option.decision}
              {...buttonProps}
              size="xs"
              variant={option.decision === "accept" ? "default" : "outline"}
            >
              {content}
            </Button>
          );
        return option.warning ? (
          <Tooltip key={option.decision}>
            <TooltipTrigger render={button} />
            <TooltipPopup side="top">{option.warning}</TooltipPopup>
          </Tooltip>
        ) : (
          button
        );
      })}
      {moreOptions.length > 0 ? (
        <Menu>
          <MenuTrigger
            disabled={unavailable}
            render={
              presentation === "inline" ? (
                <InlineButton tone="muted" aria-label={gt("More approval options")} />
              ) : (
                <Button size="icon-xs" variant="outline" aria-label={gt("More approval options")} />
              )
            }
          >
            {presentation === "inline" ? (
              gt("More", { $context: "button that opens more approval options" })
            ) : (
              <EllipsisIcon />
            )}
          </MenuTrigger>
          <MenuPopup {...composerFloatingLayerProps} side="top" align="end" width="content">
            {moreOptions.map((option) => {
              const item = (
                <MenuItem
                  key={option.decision}
                  disabled={unavailable}
                  aria-description={option.warning}
                  onClick={() => {
                    if (!unavailable) void onRespondToApproval(requestId, option.decision);
                  }}
                >
                  {option.warning ? <TriangleAlertIcon className="size-3 text-warning" /> : null}
                  <span className="min-w-0 whitespace-normal wrap-break-word">{option.label}</span>
                </MenuItem>
              );
              return option.warning ? (
                <Tooltip key={option.decision}>
                  <TooltipTrigger render={item} />
                  <TooltipPopup side="top">{option.warning}</TooltipPopup>
                </Tooltip>
              ) : (
                item
              );
            })}
          </MenuPopup>
        </Menu>
      ) : null}
    </>
  );
});
