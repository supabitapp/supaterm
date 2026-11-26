import type { DesktopPreviewOverlay } from "../previewStateStore";
import type { RightPanelSurface } from "../rightPanelStore";
import {
  confirmClose,
  confirmTerminalClose,
  type TerminalCloseTarget,
} from "./terminalCloseConfirm";
import { msg } from "gt-react";
import { m } from "~/i18n/messages";

type BrowserControllersByTabId = Readonly<
  Record<string, Pick<DesktopPreviewOverlay, "controller"> | undefined>
>;

export function agentControlledBrowserCloseConfirmation(
  surfaces: readonly RightPanelSurface[],
  desktopByTabId: BrowserControllersByTabId,
): string | null {
  const activeBrowserCount = surfaces.filter(
    (surface) =>
      surface.kind === "preview" &&
      surface.resourceId !== null &&
      desktopByTabId[surface.resourceId]?.controller === "agent",
  ).length;
  if (activeBrowserCount === 0) return null;
  if (activeBrowserCount === 1) {
    return [
      m(msg("Close browser while the agent is using it?")),
      m(
        msg(
          "The agent is actively controlling this browser. Closing it may interrupt the current browser action.",
        ),
      ),
    ].join("\n");
  }
  return [
    m(
      msg("Close {count} browsers while the agent is using them?", {
        count: activeBrowserCount,
      }),
    ),
    m(
      msg(
        "The agent is actively controlling these browsers. Closing them may interrupt the current browser actions.",
      ),
    ),
  ].join("\n");
}

export async function confirmRightPanelSurfacesClose(
  surfaces: readonly RightPanelSurface[],
  context: {
    readonly desktopByTabId: BrowserControllersByTabId;
    readonly terminalCloseTarget: (terminalId: string) => TerminalCloseTarget;
  },
) {
  const browserMessage = agentControlledBrowserCloseConfirmation(surfaces, context.desktopByTabId);
  if (browserMessage && !(await confirmClose(browserMessage))) return false;
  return confirmTerminalClose(
    surfaces.flatMap((surface) =>
      surface.kind === "terminal"
        ? surface.terminalIds.map((terminalId) => context.terminalCloseTarget(terminalId))
        : [],
    ),
  );
}
