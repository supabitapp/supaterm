import { environmentMcpUrl } from "@supaterm/client-runtime/connection";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { AuthMcpClientAccess } from "@supaterm/contracts";
import { CheckIcon, CopyIcon, PlugIcon } from "@supaterm/icons";
import { useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNowSecond } from "~/hooks/useNowSecond";
import { authEnvironment } from "~/state/auth";
import type { EnvironmentPresentation } from "~/state/environments";
import { usePreparedConnection } from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { AccessOption, accessConfig } from "../auth/ConnectAgentSurface";
import { Button } from "../ui/button";
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
import { RadioGroup } from "../ui/radio-group";
import { Spinner } from "../ui/spinner";

const APPROVAL_CODE_LABEL = "App sign-in";

type MintedCode = { readonly credential: string; readonly expiresAt: number };

/** Mints a one-use code that approves one app's MCP sign-in on `environment` at a chosen level. */
export function UseInAnotherAppDialog({
  environment,
}: {
  readonly environment: EnvironmentPresentation;
}) {
  const environmentId = environment.environmentId;
  const createPairingCredential = useAtomCommand(authEnvironment.createPairingCredential, {
    reportFailure: false,
  });
  const prepared = usePreparedConnection(environmentId);
  const mcpUrl = environmentMcpUrl({
    entry: environment.entry,
    connectedTarget: prepared._tag === "Some" ? prepared.value.target : null,
  });
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<AuthMcpClientAccess>("read-only");
  const [code, setCode] = useState<MintedCode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mint = async () => {
    setPending(true);
    setError(null);
    const result = await createPairingCredential({
      environmentId,
      input: { label: APPROVAL_CODE_LABEL, access },
    });
    setPending(false);
    if (result._tag === "Success") {
      setCode({
        credential: result.value.credential,
        expiresAt: result.value.expiresAt.epochMilliseconds,
      });
    } else if (!isAtomCommandInterrupted(result)) {
      const failure = squashAtomCommandFailure(result);
      setError(
        failure instanceof Error
          ? failure.message
          : `Could not get a code from ${environment.label}. Try again.`,
      );
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (pending) return;
        if (nextOpen) {
          setAccess("read-only");
          setCode(null);
          setError(null);
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger
        render={
          <Button size="xs" variant="outline">
            <PlugIcon aria-hidden />
            Use in another app (MCP)
          </Button>
        }
      />
      <DialogPopup className="max-w-md" showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Use Supaterm in another app (MCP)</DialogTitle>
          <DialogDescription>
            Add the URL to the app, then enter the code on the sign-in page it opens. The code
            approves one sign-in at the level you pick.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {mcpUrl ? <CopyRow label="URL" value={mcpUrl} /> : null}
          <div className="space-y-2">
            <span id="mcp-approval-access-label" className="block text-sm font-medium">
              What can the app do?
            </span>
            <RadioGroup
              aria-labelledby="mcp-approval-access-label"
              value={access}
              onValueChange={(value) => {
                if (pending) return;
                setAccess(value as AuthMcpClientAccess);
                setCode(null);
                setError(null);
              }}
            >
              {AuthMcpClientAccess.literals.map((level) => (
                <AccessOption key={level} access={level} selected={level === access} />
              ))}
            </RadioGroup>
          </div>
          {code ? <ApprovalCode code={code} access={access} /> : null}
          {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
        </DialogPanel>
        <DialogFooter variant="bare">
          <Button
            size="comfortable"
            variant="outline"
            disabled={pending}
            onClick={() => setOpen(false)}
          >
            Done
          </Button>
          <Button
            size="comfortable"
            disabled={pending}
            aria-busy={pending}
            onClick={() => void mint()}
          >
            {pending ? <Spinner /> : null}
            {pending ? "Getting code…" : code ? "New code" : "Get code"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function ApprovalCode({
  code,
  access,
}: {
  readonly code: MintedCode;
  readonly access: AuthMcpClientAccess;
}) {
  const now = useNowSecond();
  const left = Math.max(0, Math.floor((code.expiresAt - now) / 1000));
  if (left === 0) return <p className="text-xs text-muted-foreground">The code expired.</p>;
  return (
    <div className="space-y-1.5">
      <CopyRow label="Code" value={code.credential} />
      <p className="text-xs text-muted-foreground">
        Approves {accessConfig[access].label} · one use · expires {Math.floor(left / 60)}:
        {String(left % 60).padStart(2, "0")}
      </p>
    </div>
  );
}

function CopyRow({ label, value }: { readonly label: string; readonly value: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 1500, target: label });
  const Icon = isCopied ? CheckIcon : CopyIcon;
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-sm">{value}</span>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={`Copy ${label}`}
        onClick={() => copyToClipboard(value, undefined)}
      >
        <Icon className="size-3.5" />
      </Button>
    </div>
  );
}
