import { Dialog } from "@base-ui/react/dialog";
import { T, Var } from "gt-react";
import { useStore } from "zustand";

import { APP_BASE_NAME } from "../../branding";
import { desktopUpdateRestart } from "../../state/desktopUpdateRestart";

export function DesktopUpdateRestartScreen() {
  const isRestarting = useStore(desktopUpdateRestart.store, (state) => state.isRestarting);

  return (
    <Dialog.Root open={isRestarting} onOpenChange={(_open, details) => details.cancel()}>
      <Dialog.Portal>
        <Dialog.Popup className="fixed inset-0 z-110 flex items-center justify-center bg-background p-6 text-foreground">
          <div className="flex max-w-xs flex-col gap-2 text-center">
            <Dialog.Title className="text-base font-medium">
              <T>
                Restarting <Var>{APP_BASE_NAME}</Var>…
              </T>
            </Dialog.Title>
            <Dialog.Description className="text-sm text-balance text-muted-foreground">
              <T>Installing the update. The app will reopen automatically.</T>
            </Dialog.Description>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
