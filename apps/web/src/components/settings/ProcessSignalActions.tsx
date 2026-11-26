import type { ServerProcessSignal } from "@supaterm/contracts";

import { useInlineConfirm } from "../../hooks/useInlineConfirm";
import { InlineConfirmIcon } from "../InlineConfirm";
import { InlineButton } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { T, useGT, Var } from "gt-react";

/** Process ownership stays with the diagnostics view. */
export function ProcessSignalActions({
  pid,
  disabled,
  onSignal,
}: {
  pid: number;
  disabled: boolean;
  onSignal: (signal: ServerProcessSignal) => void;
}) {
  const gt = useGT();
  const confirm = useInlineConfirm<"kill">();
  const killArmed = confirm.armed === "kill";
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              disabled={disabled}
              aria-label={gt("Send {signal}", { signal: "SIGINT" })}
              tone="muted"
              onClick={() => onSignal("SIGINT")}
            >
              INT
            </InlineButton>
          }
        />
        <TooltipPopup side="top">
          <T>
            Send <Var>{"SIGINT"}</Var>
          </T>
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <InlineButton
              disabled={disabled}
              aria-label={
                killArmed
                  ? gt("Confirm {signal}", { signal: "SIGKILL" })
                  : gt("Send {signal}", { signal: "SIGKILL" })
              }
              tone="destructive"
              {...confirm.bind("kill", () => onSignal("SIGKILL"))}
            >
              <InlineConfirmIcon armed={killArmed}>KILL</InlineConfirmIcon>
            </InlineButton>
          }
        />
        <TooltipPopup side="top">
          {killArmed ? (
            gt("Click again to send {signal} to process {pid}. The process can’t handle it.", {
              signal: "SIGKILL",
              pid,
            })
          ) : (
            <T>
              Send <Var>{"SIGKILL"}</Var>
            </T>
          )}
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
