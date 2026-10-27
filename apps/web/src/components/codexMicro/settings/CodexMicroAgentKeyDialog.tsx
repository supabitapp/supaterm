import type { CodexMicroAgentAssignment, CodexMicroAgentKey } from "@supaterm/contracts";
import { scopedProjectKey, scopedThreadKey } from "@supaterm/client-runtime/environment";
import { CheckIcon, MessageSquareIcon } from "@supaterm/icons";
import { useState } from "react";

import { useProjects, useThreadShells } from "../../../state/entities";
import { Button } from "../../ui/button";
import { Command, CommandInput, CommandItem, CommandList } from "../../ui/command";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";
import { CodexMicroActionPicker } from "./CodexMicroActionPicker";
import { codexMicroAgentKeyNumber, codexMicroThreadChoices } from "./CodexMicroSettings.logic";

const THREAD_RESULT_LIMIT = 100;

type AgentKeyTab = "threads" | "shortcuts";

function CodexMicroThreadPicker({
  selected,
  onSelect,
}: {
  selected: CodexMicroAgentAssignment | null;
  onSelect: (assignment: CodexMicroAgentAssignment) => void;
}) {
  const threads = useThreadShells();
  const projects = useProjects();
  const [query, setQuery] = useState("");
  const projectTitles = new Map(
    projects.map((project) => [
      scopedProjectKey({ environmentId: project.environmentId, projectId: project.id }),
      project.title,
    ]),
  );
  const { choices, truncated } = codexMicroThreadChoices(
    threads,
    projectTitles,
    query,
    THREAD_RESULT_LIMIT,
  );

  return (
    <Command mode="none" value={query} onValueChange={setQuery} aria-label="Choose a thread">
      <CommandInput placeholder="Search threads" aria-label="Search threads" />
      <CommandList className="max-h-72 overflow-y-auto">
        {choices.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No threads found.</p>
        ) : (
          choices.map(({ thread, projectTitle }) => {
            const key = scopedThreadKey({
              environmentId: thread.environmentId,
              threadId: thread.id,
            });
            const isSelected =
              selected?.type === "thread" &&
              selected.environmentId === thread.environmentId &&
              selected.threadId === thread.id;
            return (
              <CommandItem
                key={key}
                value={key}
                onClick={() =>
                  onSelect({
                    type: "thread",
                    environmentId: thread.environmentId,
                    threadId: thread.id,
                  })
                }
              >
                <MessageSquareIcon aria-hidden className="size-4 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{thread.title || "Untitled thread"}</span>
                  {projectTitle ? (
                    <span className="truncate text-xs text-muted-foreground">{projectTitle}</span>
                  ) : null}
                </span>
                {isSelected ? <CheckIcon aria-hidden className="size-3.5 shrink-0" /> : null}
              </CommandItem>
            );
          })
        )}
        {truncated ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">
            Keep typing to find older threads.
          </p>
        ) : null}
      </CommandList>
    </Command>
  );
}

export function CodexMicroAgentKeyDialog({
  agentKey,
  assignment,
  onChange,
  onClose,
}: {
  agentKey: CodexMicroAgentKey;
  assignment: CodexMicroAgentAssignment | null;
  onChange: (assignment: CodexMicroAgentAssignment | null) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<AgentKeyTab>(
    assignment?.type === "action" ? "shortcuts" : "threads",
  );
  const assign = (next: CodexMicroAgentAssignment | null) => {
    onChange(next);
    onClose();
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="w-full sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign agent key {codexMicroAgentKeyNumber(agentKey)}</DialogTitle>
          <DialogDescription>Choose a thread to follow or a shortcut to run</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex min-h-0 flex-col">
          <ToggleGroup
            aria-label="Assignment type"
            className="w-full *:flex-1"
            value={[tab]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "threads" || value === "shortcuts") setTab(value);
            }}
          >
            <Toggle value="threads">Threads</Toggle>
            <Toggle value="shortcuts">Shortcuts</Toggle>
          </ToggleGroup>
          {tab === "threads" ? (
            <CodexMicroThreadPicker selected={assignment} onSelect={assign} />
          ) : (
            <CodexMicroActionPicker
              label="Choose a shortcut"
              selected={assignment?.type === "action" ? assignment.action : undefined}
              onSelect={(action) => {
                if (action !== null) assign({ type: "action", action });
              }}
            />
          )}
        </DialogPanel>
        <DialogFooter>
          <Button
            variant="ghost-destructive"
            className="sm:me-auto"
            disabled={assignment === null}
            onClick={() => assign(null)}
          >
            Remove assignment
          </Button>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
