import { useAtomValue } from "@effect/atom-react";
import {
  AuthAccessWriteScope,
  AuthDiagnosticsReadScope,
  AuthFilesystemReadScope,
  AuthGrantScope,
  AuthOrchestrationReadScope,
  AuthStandardClientScopes,
  AuthTerminalReadScope,
  type AuthEnvironmentScope,
  type AuthPairingCredentialResult,
  type RelayConnectionInfo,
} from "@supaterm/contracts";
import { settlePromise, squashAtomCommandFailure } from "@supaterm/client-runtime/state/runtime";
import { AUTH_SCOPE_OPTIONS } from "@supaterm/shared/authScopeOptions";
import { LinkIcon, PlusIcon } from "@supaterm/icons";
import { type RefObject, useId, useRef, useState } from "react";

import { createServerPairingCredential } from "~/environments/primary";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { readEnvironmentScope } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { togglePairingScopeSelection } from "./ConnectionsSettings.logic";

const PERMISSION_SCOPES = {
  standard: AuthStandardClientScopes,
  "read-only": [
    AuthOrchestrationReadScope,
    AuthFilesystemReadScope,
    AuthDiagnosticsReadScope,
    AuthTerminalReadScope,
  ],
};

const PERMISSION_PRESETS = [
  {
    value: "standard",
    label: "Standard",
    description:
      "Run agents, work with files, use terminals, and manage device access with the permissions you can share.",
  },
  {
    value: "read-only",
    label: "Read only",
    description: "Follow threads, browse files, and view terminal output without making changes.",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Choose which of your permissions to share with this device.",
  },
] as const;

export function CreatePairingLinkDialog({
  triggerRef,
  relayEnabled,
  delegatableScopes,
  onPairingLinkCreated,
}: {
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly relayEnabled: boolean;
  readonly delegatableScopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly onPairingLinkCreated: (
    result: AuthPairingCredentialResult,
    relay?: RelayConnectionInfo,
  ) => void;
}) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const prepareRelay = useAtomCommand(serverEnvironment.prepareRelay, { reportFailure: false });
  const canPrepareRelay = useAtomValue(
    serverEnvironment.prepareRelay.permissionAtom(primaryEnvironmentId),
  );
  const permissionsId = useId();
  const createButtonRef = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [preset, setPreset] = useState<(typeof PERMISSION_PRESETS)[number]["value"]>("standard");
  const [customScopes, setCustomScopes] = useState<ReadonlyArray<AuthGrantScope>>([]);
  const [stage, setStage] = useState<"idle" | "relay" | "creating">("idle");
  const pending = stage !== "idle";
  const selectedScopes = (preset === "custom" ? customScopes : PERMISSION_SCOPES[preset]).filter(
    (scope) => delegatableScopes.includes(scope),
  );
  const canCreate = selectedScopes.length > 0 && (!relayEnabled || canPrepareRelay);
  const buttonLabel = {
    idle: "Create link",
    relay: "Preparing connection…",
    creating: "Creating link…",
  }[stage];

  const createLink = async () => {
    if (
      pending ||
      primaryEnvironmentId === null ||
      selectedScopes.length === 0 ||
      !readEnvironmentScope(primaryEnvironmentId, AuthAccessWriteScope) ||
      !selectedScopes.every((scope) => readEnvironmentScope(primaryEnvironmentId, scope))
    )
      return;
    setStage(relayEnabled ? "relay" : "creating");
    const result = await settlePromise(async () => {
      let relay: RelayConnectionInfo | undefined;
      if (relayEnabled) {
        const prepared = await prepareRelay({ environmentId: primaryEnvironmentId, input: {} });
        if (prepared._tag === "Failure") throw squashAtomCommandFailure(prepared);
        relay = prepared.value;
      }
      setStage("creating");
      const created = await createServerPairingCredential({ label, scopes: selectedScopes });
      setOpen(false);
      onPairingLinkCreated(created, relay);
    });
    if (result._tag === "Failure") {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not create pairing link",
          description: error instanceof Error ? error.message : "Try creating the link again.",
        }),
      );
    }
    setStage("idle");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        if (nextOpen) {
          setLabel("");
          setPreset("standard");
          setCustomScopes([]);
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger
        render={
          <Button ref={triggerRef} size="xs">
            <PlusIcon aria-hidden />
            Add device
          </Button>
        }
      />
      <DialogPopup
        className="max-w-md"
        showCloseButton={!pending}
        initialFocus={canCreate ? createButtonRef : undefined}
      >
        <DialogHeader>
          <DialogTitle>Add a device</DialogTitle>
          <DialogDescription>
            Create a one-time link, then open it on your other device to connect to this
            environment.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <label className="block space-y-2">
            <span className="flex items-baseline gap-2 text-sm font-medium">
              Device name
              <span className="text-xs font-normal text-muted-foreground">Optional</span>
            </span>
            <Input
              size="comfortable"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="e.g. Living room iPad"
              disabled={pending}
            />
          </label>
          <div className="space-y-2">
            <label htmlFor={permissionsId} className="block text-sm font-medium">
              Permissions
            </label>
            <Select
              items={PERMISSION_PRESETS}
              value={preset}
              disabled={pending}
              onValueChange={(value) => {
                if (value === null) return;
                if (value === "custom") setCustomScopes(selectedScopes);
                setPreset(value);
              }}
            >
              <SelectTrigger id={permissionsId} size="comfortable">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {PERMISSION_PRESETS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            <p className="min-h-10 text-xs leading-5 text-muted-foreground">
              {PERMISSION_PRESETS.find((item) => item.value === preset)?.description}
            </p>
          </div>
          {preset === "custom" ? (
            <div className="divide-y divide-border/60 overflow-hidden rounded-lg border border-input">
              {AUTH_SCOPE_OPTIONS.filter(({ scope }) => delegatableScopes.includes(scope)).map(
                ({ scope, title, description }) => (
                  <label
                    key={scope}
                    className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-3 transition-colors duration-150 hover:bg-muted/40 has-disabled:cursor-default"
                  >
                    <Checkbox
                      className="mt-0.5"
                      checked={selectedScopes.includes(scope)}
                      disabled={pending}
                      onCheckedChange={(checked) =>
                        setCustomScopes((current) =>
                          togglePairingScopeSelection(current, scope, checked === true),
                        )
                      }
                    />
                    <span className="min-w-0 space-y-0.5">
                      <span className="block text-xs font-medium">{title}</span>
                      <span className="block text-xs leading-5 text-muted-foreground">
                        {description}
                      </span>
                    </span>
                  </label>
                ),
              )}
            </div>
          ) : null}
          <div className="min-h-10 text-xs leading-5" aria-live="polite">
            {selectedScopes.length === 0 ? (
              <p className="text-destructive">Select at least one permission to continue.</p>
            ) : selectedScopes.includes(AuthAccessWriteScope) ? (
              <p className="text-warning">
                This device can also give or revoke access to other devices.
              </p>
            ) : (
              <p className="text-muted-foreground">
                You can revoke this device’s access anytime in Authorized clients.
              </p>
            )}
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            size="comfortable"
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            ref={createButtonRef}
            size="comfortable"
            className="w-full sm:w-52"
            disabled={pending || !canCreate}
            aria-busy={pending}
            onClick={() => void createLink()}
          >
            {pending ? <Spinner /> : <LinkIcon aria-hidden />}
            <span aria-live="polite">{buttonLabel}</span>
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
