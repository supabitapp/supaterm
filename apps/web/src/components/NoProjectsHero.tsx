import { MessageSquareMoreIcon, PlusIcon } from "@supaterm/icons";

import { openCommandPalette } from "../commandPaletteBus";
import { isElectron } from "../env";
import { useScratchProject } from "../hooks/useScratchProject";
import { useShortcutLabel } from "../hooks/useShortcutLabel";
import { usePrimaryEnvironmentId } from "../state/environments";
import { Button } from "./ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

export function NoProjectsHero() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, startScratchThread } = useScratchProject();
  const scratchTargetEnvironmentId = scratchEnvironmentId(primaryEnvironmentId);
  const noProjectShortcut = useShortcutLabel("chat.newWithoutProject");

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        {/* The desktop window only moves where CSS opts in, so keep a titlebar strip. */}
        {isElectron ? <WorkspacePageHeader electron /> : null}
        <Empty size="hero" className="flex-1">
          <div className="w-full max-w-lg px-8 py-12">
            <EmptyHeader className="max-w-none">
              <EmptyTitle>What should we work on?</EmptyTitle>
              <EmptyDescription>
                {scratchTargetEnvironmentId === null
                  ? "Add a project to start your first thread."
                  : "Add a project, or start without one."}
              </EmptyDescription>
              <div className="mt-6 flex justify-center gap-2">
                <Button size="sm" onClick={() => openCommandPalette({ open: "add-project" })}>
                  <PlusIcon className="size-4" />
                  Add project
                </Button>
                {scratchTargetEnvironmentId === null ? null : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void startScratchThread(scratchTargetEnvironmentId)}
                        />
                      }
                    >
                      <MessageSquareMoreIcon className="size-4" />
                      Start without a project
                    </TooltipTrigger>
                    {noProjectShortcut ? (
                      <TooltipPopup side="bottom" shortcut={noProjectShortcut}>
                        New thread without a project
                      </TooltipPopup>
                    ) : null}
                  </Tooltip>
                )}
              </div>
            </EmptyHeader>
          </div>
        </Empty>
      </div>
    </SidebarInset>
  );
}
