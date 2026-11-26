import {
  type AuthMcpApprovalDecision,
  type AuthMcpApprovalDetails,
  AuthMcpApprovalError,
  AuthMcpClientAccess,
  AuthMcpAuthorizationRequest,
  parseMcpApprovalCode,
} from "@supaterm/contracts";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { isLoopbackHost } from "@supaterm/shared/preview";
import { EyeIcon, type IconComponent } from "@supaterm/icons";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { type ReactNode, useEffect, useState } from "react";

import { PrimaryEnvironmentHttpClient } from "~/environments/primary/httpClient";
import { runPrimaryHttp } from "~/lib/runtime";
import { cn } from "~/lib/utils";
import { accessCeilingReason, resolveApprovalDecision } from "./ConnectAgentSurface.logic";
import { runtimeModeConfig } from "../chat/runtimeModeConfig";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { RadioGroup } from "../ui/radio-group";
import { Spinner } from "../ui/spinner";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import { m } from "~/i18n/messages";

export const accessConfig: Record<
  AuthMcpClientAccess,
  { readonly label: string; readonly description: string; readonly icon: IconComponent }
> = {
  "read-only": {
    label: msg("Read only"),
    description: msg("Read projects and threads. Cannot start, message or change anything."),
    icon: EyeIcon,
  },
  ...runtimeModeConfig,
};

function redirectsToThisComputer(redirectHost: string): boolean {
  return isLoopbackHost(new URL(`http://${redirectHost}`).hostname);
}

type Loaded =
  | { readonly status: "loading" }
  | { readonly status: "invalid"; readonly message: string }
  | { readonly status: "ready"; readonly details: AuthMcpApprovalDetails };

const UNREACHABLE = msg("Could not reach this environment. Try again.");
const isApprovalError = Schema.is(AuthMcpApprovalError);

type Answer<A> =
  | { readonly kind: "ok"; readonly value: A }
  | { readonly kind: "redirect"; readonly url: string }
  | { readonly kind: "error"; readonly message: string };

function runApproval<A>(
  call: (
    client: Context.Service.Shape<typeof PrimaryEnvironmentHttpClient>,
  ) => Effect.Effect<A | { readonly redirectTo: string }, unknown>,
): Promise<Answer<A>> {
  return runPrimaryHttp(
    PrimaryEnvironmentHttpClient.pipe(
      Effect.flatMap(call),
      Effect.map((value): Answer<A> =>
        typeof value === "object" && value !== null && "redirectTo" in value
          ? { kind: "redirect", url: value.redirectTo }
          : { kind: "ok", value: value as A },
      ),
      Effect.catch((error) =>
        Effect.succeed<Answer<A>>({
          kind: "error",
          message: isApprovalError(error) ? error.message : m(UNREACHABLE),
        }),
      ),
    ),
  ).catch((): Answer<A> => ({ kind: "error", message: m(UNREACHABLE) }));
}

const decodeAuthorizationRequest = Schema.decodeSync(AuthMcpAuthorizationRequest);

function readAuthorizationRequest(): AuthMcpAuthorizationRequest {
  return decodeAuthorizationRequest(Object.fromEntries(new URL(window.location.href).searchParams));
}

export function ConnectAgentSurface() {
  const gt = useGT();
  const messages = useMessages();
  const [authorization] = useState(readAuthorizationRequest);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [access, setAccess] = useState<AuthMcpClientAccess>("read-only");
  const [pairingCode, setPairingCode] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [pending, setPending] = useState<"approve" | "deny" | null>(null);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- fetches the MCP OAuth approval and redirects the window or stores details, ignoring stale answers
  useEffect(() => {
    let cancelled = false;
    void runApproval((client) => client.mcpOAuth.approval({ payload: authorization })).then(
      (answer) => {
        if (cancelled) return;
        if (answer.kind === "redirect") {
          window.location.replace(answer.url);
          return;
        }
        setLoaded(
          answer.kind === "error"
            ? { status: "invalid", message: answer.message }
            : { status: "ready", details: answer.value },
        );
      },
    );
    return () => {
      cancelled = true;
    };
  }, [authorization]);

  const decide = async (choice: "approve" | "deny") => {
    if (loaded.status !== "ready") return;
    const decision: AuthMcpApprovalDecision | null =
      choice === "deny"
        ? { _tag: "deny" }
        : resolveApprovalDecision({ code: pairingCode, access, details: loaded.details });
    if (decision === null) return;
    setPending(choice);
    setErrorMessage("");
    const answer = await runApproval((client) =>
      client.mcpOAuth.decision({ payload: { authorization, decision } }),
    );
    if (answer.kind === "redirect") {
      window.location.replace(answer.url);
      return;
    }
    setPending(null);
    setErrorMessage(
      answer.kind === "error" ? answer.message : gt("The sign-in could not continue."),
    );
  };

  if (loaded.status === "loading") {
    return (
      <StandalonePage>
        <ConnectAgentHeading
          title={gt("Checking the sign-in request")}
          description={gt("One moment while this environment verifies the agent's request.")}
        />
        <Spinner className="mt-6" size="lg" tone="muted" />
      </StandalonePage>
    );
  }

  if (loaded.status === "invalid") {
    return (
      <StandalonePage>
        <ConnectAgentHeading
          title={gt("This sign-in cannot continue")}
          description={loaded.message}
        />
        <p className="mt-4 text-sm text-muted-foreground">
          <T>Close this page and start the sign-in again from your agent.</T>
        </p>
      </StandalonePage>
    );
  }

  const { details } = loaded;
  const canApprove =
    pending === null && resolveApprovalDecision({ code: pairingCode, access, details }) !== null;
  // A code from "Use Supaterm in another app (MCP)" names its level, so the page does not ask again.
  const codeAccess = parseMcpApprovalCode(pairingCode)?.access;

  return (
    <StandalonePage>
      <ConnectAgentHeading
        title={gt("Connect {app}", { app: details.clientName })}
        description={
          <T>
            This agent wants to use the threads in every project on{" "}
            <span className="font-medium text-foreground">
              <Var>{details.environmentHost}</Var>
            </span>
            .
          </T>
        }
      />
      <p className="mt-2 text-xs text-muted-foreground">
        {redirectsToThisComputer(details.redirectHost) ? (
          <T>
            The name is chosen by the agent. Approval returns to <Var>{details.redirectHost}</Var>{" "}
            on the computer that opened this page. Only approve a sign-in you just started.
          </T>
        ) : (
          <T>
            The name is chosen by the agent. Approval gives access to whoever runs{" "}
            <span className="font-medium text-foreground">
              <Var>{details.redirectHost}</Var>
            </span>
            . Only approve a sign-in you just started there.
          </T>
        )}
      </p>

      <form
        className="mt-6 space-y-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (canApprove) void decide("approve");
        }}
      >
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="connect-agent-pairing-code">
            <T>Sign-in code</T>
          </label>
          <Input
            id="connect-agent-pairing-code"
            autoCapitalize="none"
            autoComplete="one-time-code"
            autoCorrect="off"
            disabled={pending !== null}
            nativeInput
            onChange={(event) => setPairingCode(event.currentTarget.value)}
            placeholder={gt("Paste a code")}
            spellCheck={false}
            value={pairingCode}
          />
          <p className="text-xs text-muted-foreground">
            <T>
              Get one from Use Supaterm in another app (MCP) in Settings → Sharing & access, create
              a pairing code there, or run <code>supaterm auth pairing create</code> on this
              machine.
            </T>
          </p>
        </div>

        {codeAccess ? (
          <p className="text-sm">
            <span className="text-muted-foreground">
              <T context="access level">Access</T>
            </span>{" "}
            <span className="font-medium">{messages(accessConfig[codeAccess].label)}</span>
          </p>
        ) : (
          <div className="space-y-2">
            <span id="connect-agent-access-label" className="text-sm font-medium">
              <T>What it may do</T>
            </span>
            <RadioGroup
              aria-labelledby="connect-agent-access-label"
              value={access}
              onValueChange={(value) => setAccess(value as AuthMcpClientAccess)}
            >
              {AuthMcpClientAccess.literals.map((option) => (
                <AccessOption
                  key={option}
                  access={option}
                  selected={option === access}
                  managedReason={accessCeilingReason(details, option)}
                />
              ))}
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              <T>
                Beyond read only, it can start, message and stop threads, and none of them can run
                with more than the mode you pick.
              </T>
            </p>
          </div>
        )}

        {errorMessage ? (
          <Alert variant="error">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button disabled={!canApprove} type="submit">
            {pending === "approve"
              ? gt("Approving…")
              : codeAccess
                ? gt("Approve {level}", { level: messages(accessConfig[codeAccess].label) })
                : gt("Approve", { $context: "verb, approves the agent sign-in" })}
          </Button>
          <Button
            disabled={pending !== null}
            onClick={() => void decide("deny")}
            type="button"
            variant="outline"
          >
            {pending === "deny" ? gt("Denying…") : gt("Deny")}
          </Button>
        </div>
      </form>
    </StandalonePage>
  );
}

function ConnectAgentHeading({
  title,
  description,
}: {
  readonly title: string;
  readonly description: ReactNode;
}) {
  const gt = useGT();
  return (
    <StandalonePageHeader context={gt("Agent sign-in")} title={title} description={description} />
  );
}

export function AccessOption({
  access,
  selected,
  managedReason,
}: {
  readonly access: AuthMcpClientAccess;
  readonly selected: boolean;
  readonly managedReason?: string | undefined;
}) {
  const messages = useMessages();
  const { label, description, icon: Icon } = accessConfig[access];
  return (
    <RadioPrimitive.Root
      value={access}
      disabled={managedReason !== undefined}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-left outline-none transition-[background-color,border-color,box-shadow] data-disabled:cursor-not-allowed data-disabled:opacity-50",
        "focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        selected
          ? "border-primary bg-background ring-2 ring-inset ring-primary/25 dark:border-transparent dark:bg-primary/10 dark:ring-1 dark:ring-primary/30"
          : "border-border bg-background hover:bg-muted/50 dark:border-transparent dark:bg-white/[0.035] dark:hover:bg-accent",
      )}
    >
      <Icon
        aria-hidden
        className={cn(
          "mt-0.5 size-4 shrink-0",
          selected ? "text-primary" : "text-muted-foreground",
        )}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{messages(label)}</span>
        <span className="block text-xs text-muted-foreground">
          {managedReason ?? messages(description)}
        </span>
      </span>
    </RadioPrimitive.Root>
  );
}
