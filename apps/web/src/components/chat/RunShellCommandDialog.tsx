import { useRef, type ReactNode } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

export function RunShellCommandDialog({
  command,
  onClose,
  onRun,
  children,
}: {
  command: string;
  onClose: () => void;
  onRun: (command: string) => void;
  children: ReactNode;
}) {
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const ranRef = useRef(false);
  const lineCount = command.split("\n").length;

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      {/* Running focuses the thread terminal; returning focus to the trigger would steal it back. */}
      <AlertDialogPopup initialFocus={runButtonRef} finalFocus={() => !ranRef.current}>
        <AlertDialogHeader>
          <AlertDialogTitle>Run {lineCount} lines in terminal?</AlertDialogTitle>
          <AlertDialogDescription>
            Review the script before running it in this thread's terminal.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="px-6 pb-6">
          <div className="chat-markdown max-h-80 overflow-auto whitespace-pre [&_pre.invisible]:visible">
            {children}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            ref={runButtonRef}
            onClick={() => {
              ranRef.current = true;
              onClose();
              onRun(command);
            }}
          >
            Run
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
