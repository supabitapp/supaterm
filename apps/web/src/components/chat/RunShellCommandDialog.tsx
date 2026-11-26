import { T, useGT } from "gt-react";
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
  lineCount,
  onClose,
  onRun,
  children,
}: {
  command: string;
  lineCount: number;
  onClose: () => void;
  onRun: (command: string) => void;
  children: ReactNode;
}) {
  const gt = useGT();
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const ranRef = useRef(false);

  return (
    <AlertDialog open onOpenChange={(open) => !open && onClose()}>
      {/* Running focuses the thread terminal; returning focus to the trigger would steal it back. */}
      <AlertDialogPopup initialFocus={runButtonRef} finalFocus={() => !ranRef.current}>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {gt(
              "{count, plural, one {Run {count} lines in terminal?} other {Run {count} lines in terminal?}}",
              { count: lineCount },
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <T>Review the script before running it in this thread's terminal.</T>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="px-6 pb-6">
          <div className="chat-markdown max-h-80 overflow-auto whitespace-pre [&_pre.invisible]:visible">
            {children}
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>
            <T>Cancel</T>
          </AlertDialogClose>
          <Button
            ref={runButtonRef}
            onClick={() => {
              ranRef.current = true;
              onClose();
              onRun(command);
            }}
          >
            <T context="verb, runs the script in the terminal">Run</T>
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
