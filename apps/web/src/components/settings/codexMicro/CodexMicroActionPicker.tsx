import type { CodexMicroAction } from "@supaterm/contracts";
import { CheckIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { sameCodexMicroAction } from "../../codexMicro/codexMicroCatalog";
import {
  Command,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../ui/command";
import { codexMicroActionValue, filterCodexMicroCommandGroups } from "./CodexMicroSettings.logic";

const CLEAR_VALUE = "clear";

/** A searchable list of the actions Codex Micro can trigger. */
export function CodexMicroActionPicker({
  label,
  selected,
  clearLabel,
  onSelect,
}: {
  label: string;
  /** `null` marks the clear row as current; `undefined` marks nothing. */
  selected: CodexMicroAction | null | undefined;
  clearLabel?: string;
  onSelect: (action: CodexMicroAction | null) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = filterCodexMicroCommandGroups(query);
  const showClear = clearLabel !== undefined && query.trim().length === 0;

  return (
    <Command mode="none" value={query} onValueChange={setQuery} aria-label={label}>
      <CommandInput placeholder="Search actions" aria-label={`${label}: search actions`} />
      <CommandList className="max-h-64 overflow-y-auto">
        {showClear ? (
          <CommandItem value={CLEAR_VALUE} onClick={() => onSelect(null)}>
            <XIcon aria-hidden className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{clearLabel}</span>
            {selected === null ? <CheckIcon aria-hidden className="size-3.5 shrink-0" /> : null}
          </CommandItem>
        ) : null}
        {groups.map((group) => (
          <CommandGroup key={group.label}>
            <CommandGroupLabel>{group.label}</CommandGroupLabel>
            {group.options.map((option) => (
              <CommandItem
                key={codexMicroActionValue(option.action)}
                value={codexMicroActionValue(option.action)}
                onClick={() => onSelect(option.action)}
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {sameCodexMicroAction(option.action, selected) ? (
                  <CheckIcon aria-hidden className="size-3.5 shrink-0" />
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
        {groups.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-muted-foreground">No actions found.</p>
        ) : null}
      </CommandList>
    </Command>
  );
}
