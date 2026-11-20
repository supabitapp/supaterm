import type { EnvironmentId } from "@supaterm/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import { ChevronRightIcon } from "@supaterm/icons";
import { useState } from "react";

import { connectPairing } from "../../connection/onboarding";
import { isImeComposing } from "../../lib/imeComposition";
import { useAtomCommand } from "../../state/use-atom-command";
import { InstallSupatermCommands } from "../InstallSupatermCommands";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import { WelcomeSection, WelcomeShell } from "./WelcomePage";

/** The Welcome page before there is a computer to set up, as on hosted web. */
export function WelcomePairing({
  onPaired,
}: {
  readonly onPaired: (environmentId: EnvironmentId) => void;
}) {
  const connectPairingEnvironment = useAtomCommand(connectPairing, { reportFailure: false });
  const [pairingUrl, setPairingUrl] = useState("");
  const [isPairing, setIsPairing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const submit = async () => {
    if (isPairing || pairingUrl.trim().length === 0) return;
    setIsPairing(true);
    setErrorMessage("");
    const result = await connectPairingEnvironment({ pairingUrl: pairingUrl.trim() });
    setIsPairing(false);
    if (result._tag === "Success") {
      onPaired(result.value);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const cause = squashAtomCommandFailure(result);
    setErrorMessage(cause instanceof Error ? cause.message : "Pairing failed.");
  };

  return (
    <WelcomeShell subtitle="Connect the computer you want to work on.">
      <div className="mt-10 border-t border-border/60">
        <WelcomeSection title="Computer">
          <form
            className="space-y-3 py-2"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <div>
              <label
                className="block text-sm text-muted-foreground"
                htmlFor="onboarding-pairing-url"
              >
                Pairing link
              </label>
              <Input
                id="onboarding-pairing-url"
                autoFocus
                aria-invalid={errorMessage.length > 0}
                aria-describedby={errorMessage ? "onboarding-pairing-error" : undefined}
                className="mt-2"
                size="lg"
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                nativeInput
                readOnly={isPairing}
                placeholder="https://your-server:5230/pair#token=…"
                value={pairingUrl}
                onChange={(event) => setPairingUrl(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && isImeComposing(event)) {
                    event.preventDefault();
                  }
                }}
              />
            </div>
            {errorMessage ? (
              <Alert id="onboarding-pairing-error" variant="error">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}
            <Collapsible>
              <div className="flex items-center justify-between gap-3">
                <CollapsibleTrigger
                  type="button"
                  className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ChevronRightIcon className="size-3.5 group-data-panel-open:rotate-90" />
                  Need a pairing link?
                </CollapsibleTrigger>
                <Button type="submit" disabled={isPairing || pairingUrl.trim().length === 0}>
                  {isPairing ? "Pairing..." : "Pair"}
                </Button>
              </div>
              <CollapsiblePanel>
                <p className="pt-3 text-sm text-muted-foreground">
                  On the computer with your code:
                </p>
                <InstallSupatermCommands command="supaterm pair" className="mt-2" />
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  Start Supaterm or run <code className="font-mono">supaterm serve</code> there
                  before <code className="font-mono">supaterm pair</code>. On a tailnet, run{" "}
                  <code className="font-mono">supaterm pair --tailscale</code> instead.
                </p>
              </CollapsiblePanel>
            </Collapsible>
          </form>
        </WelcomeSection>
      </div>
    </WelcomeShell>
  );
}
