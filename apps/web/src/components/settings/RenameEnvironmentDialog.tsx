import { squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { useId, useRef, useState } from "react";

import { environmentCatalog } from "~/connection/catalog";
import type { EnvironmentPresentation } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";

export function RenameEnvironmentDialog({
  environment,
  onClose,
}: {
  readonly environment: Pick<EnvironmentPresentation, "environmentId" | "label" | "entry">;
  readonly onClose: () => void;
}) {
  const rename = useAtomCommand(environmentCatalog.rename, { reportFailure: false });
  const [label, setLabel] = useState(environment.label);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const labelId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  async function save(nextLabel: string | null) {
    if (pending || nextLabel?.trim() === "") return;
    setPending(true);
    setError(null);
    const result = await rename({ environmentId: environment.environmentId, label: nextLabel });
    setPending(false);
    if (result._tag === "Success") {
      onClose();
    } else {
      const cause = squashAtomCommandFailure(result);
      setError(cause instanceof Error ? cause.message : "Could not rename host.");
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup
        initialFocus={inputRef}
        showCloseButton={!pending}
        render={
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save(label);
            }}
          />
        }
      >
        <DialogHeader>
          <DialogTitle>Rename host</DialogTitle>
          <DialogDescription>Choose a label for this host on this device.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-2">
            <label htmlFor={labelId} className="text-sm font-medium">
              Label
            </label>
            <Input
              ref={inputRef}
              id={labelId}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onFocus={(event) => event.target.select()}
              disabled={pending}
              autoComplete="off"
              placeholder="My MacBook"
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter>
          {environment.entry.defaultLabel !== undefined && (
            <Button
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => void save(null)}
            >
              Reset to default
            </Button>
          )}
          <DialogClose render={<Button variant="outline" disabled={pending} />}>Cancel</DialogClose>
          <Button type="submit" disabled={pending || label.trim() === ""}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
