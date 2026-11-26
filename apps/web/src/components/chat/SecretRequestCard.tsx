import { useAtomValue } from "@effect/atom-react";
import { pipe } from "effect/Function";
import {
  secretRequestAnswerInput,
  secretRequestDisplay,
  secretRequestFailureMessage,
  secretRequestInputs,
  secretRequestLink,
  SECRET_REQUEST_PRIVACY_NOTE,
  secretRequestReference,
  secretRequestSources,
  secretRequestValue,
  type SecretRequestInput,
  type SecretRequestItem,
  type SecretRequestReply,
  type SecretRequestSource,
} from "@supaterm/client-runtime/secret-request";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type OrchestrationV2ProjectedTurnItem,
  type SecretProviderId,
} from "@supaterm/contracts";
import {
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  MinusIcon,
  ShieldCheckIcon,
} from "@supaterm/icons";
import { useId, useRef, useState, type FormEvent } from "react";

import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { SecretSourceSelect } from "../settings/SecretSourceInput";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { WorkLogRow } from "./WorkLog";
import { T, useGT, Var, useMessages } from "gt-react";

export function SecretRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
}) {
  const messages = useMessages();
  const { item } = props;
  const display = secretRequestDisplay(item, props.visibility, messages);
  if (display.kind === "expired") {
    return (
      <div
        data-v2-item-type={item.type}
        className="flex min-w-0 items-start gap-2.5 rounded-xl border border-border/60 bg-card p-4"
      >
        <ClockIcon className="mt-0.5 size-4 shrink-0 text-icon-muted" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium wrap-anywhere text-foreground">
            {item.label} · {display.label}
          </p>
          <p className="text-sm text-muted-foreground">{display.hint}</p>
        </div>
      </div>
    );
  }
  if (display.kind === "answered" || display.kind === "pending-elsewhere") {
    const Icon =
      display.kind === "pending-elsewhere"
        ? LockIcon
        : display.outcome === "saved"
          ? CheckIcon
          : MinusIcon;
    return (
      <WorkLogRow
        data-v2-item-type={item.type}
        icon={<Icon className="size-3.5 text-icon-muted" aria-hidden />}
        label={
          <>
            {item.label} · {display.label}
          </>
        }
      />
    );
  }
  return <PendingSecretRequestForm environmentId={props.environmentId} item={item} />;
}

const NO_SOURCES: ReadonlyArray<SecretRequestSource> = [];

function useSecretRequestSources(environmentId: EnvironmentId) {
  const config = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  // The server accepts a reference answer only with this scope; without it the card is typed.
  const canUseReferences = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  return canUseReferences && config?.secretProviderSettings === true
    ? secretRequestSources(config, config.settings.secretProviders)
    : NO_SOURCES;
}

function PendingSecretRequestForm(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
}) {
  const messages = useMessages();
  const { item } = props;
  const formId = useId();
  const inputs = secretRequestInputs(item, messages);
  const inputId = (index: number) => `${formId}-${index}`;
  const errorId = useId();
  const privacyId = useId();
  const answer = useAtomCommand(serverEnvironment.answerSecretRequest, {
    label: "answer secret request",
    // The failure cause holds the request; keep it out of the console.
    reportFailure: false,
    reportDefect: false,
  });
  const canAnswer = useAtomValue(
    serverEnvironment.answerSecretRequest.permissionAtom(props.environmentId),
  );
  // A reference answers one value, so a card with fields is always typed.
  const configuredSources = useSecretRequestSources(props.environmentId);
  const sources = item.fields === undefined ? configuredSources : NO_SOURCES;
  const [sourceId, setSourceId] = useState<SecretProviderId | null>(null);
  const source = sources.find((candidate) => candidate.id === sourceId) ?? null;
  const [reference, setReference] = useState("");
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const locked = submitting || !canAnswer;
  const [error, setError] = useState<string | null>(null);
  // Enter and click can both submit before a render.
  const inFlight = useRef(false);

  const send = async (reply: SecretRequestReply) => {
    const input = secretRequestAnswerInput(item, reply);
    if (input === null || inFlight.current || !canAnswer) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    // A filled login leaving the screen makes the system offer to save it as a password.
    if (reply.type === "save") setValues({});
    const result = await answer({ environmentId: props.environmentId, input }).finally(() => {
      inFlight.current = false;
      setSubmitting(false);
    });
    if (result._tag === "Success") {
      setReference("");
      return;
    }
    if (reply.type === "save") setValues(reply.values);
    if (!isAtomCommandInterrupted(result)) {
      pipe(
        squashAtomCommandFailure(result),
        (failure) => secretRequestFailureMessage(failure, messages),
        setError,
      );
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (source === null) {
      void send({ type: "save", values });
    } else if (secretRequestReference(source, reference) === undefined) {
      setError(source.invalidReferenceMessage);
    } else {
      void send({ type: "reference", source, reference });
    }
  };
  const incomplete =
    source === null
      ? secretRequestAnswerInput(item, { type: "save", values }) === null
      : reference.trim().length === 0;
  const describedBy = error !== null ? `${privacyId} ${errorId}` : privacyId;
  const link = secretRequestLink(item);
  const renderField = (input: SecretRequestInput, index: number) => (
    <SecretRequestField
      key={input.key}
      id={inputId(index)}
      input={input}
      value={secretRequestValue(values, input.key)}
      disabled={locked}
      invalid={error !== null}
      describedBy={describedBy}
      showLabel={item.fields !== undefined}
      onChange={(value) => setValues((current) => ({ ...current, [input.key]: value }))}
    />
  );

  return (
    <form
      data-v2-item-type={item.type}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-border/60 bg-card p-4"
      onSubmit={onSubmit}
      autoComplete="off"
      // On click, not pointerdown: the mousedown that follows a pointerdown
      // moves focus back off the input. A click that ends a text selection
      // leaves it alone so the reason can still be copied.
      onClick={(event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest("input, button, a")) return;
        if (window.getSelection()?.isCollapsed === false) return;
        const empty = inputs.findIndex((input) => secretRequestValue(values, input.key) === "");
        document.getElementById(inputId(Math.max(empty, 0)))?.focus();
      }}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {item.fields === undefined ? (
          <label htmlFor={inputId(0)} className="text-sm font-medium text-foreground">
            {item.label}
          </label>
        ) : (
          <p className="text-sm font-medium text-foreground">{item.label}</p>
        )}
        {item.reason.trim() ? (
          <p className="text-sm wrap-anywhere text-muted-foreground">{item.reason}</p>
        ) : null}
      </div>
      {link !== null ? (
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <Button
            variant="outline"
            size="sm"
            render={<a href={link.href} target="_blank" rel="noopener noreferrer" />}
          >
            <T>
              Open <Var>{link.host}</Var>
            </T>
            <ExternalLinkIcon aria-hidden />
          </Button>
          {/* A link found in the reason is already shown there. */}
          {item.url !== undefined ? (
            <p className="font-mono text-xs wrap-anywhere text-muted-foreground">{item.url}</p>
          ) : null}
        </div>
      ) : null}
      {inputs.slice(0, -1).map(renderField)}
      <div className="flex min-w-0 items-end gap-2">
        {sources.length > 0 ? (
          <SecretSourceSelect
            value={source?.id ?? null}
            sources={sources}
            label={item.label}
            disabled={locked}
            onValueChange={(next) => {
              setSourceId(next);
              setError(null);
            }}
          />
        ) : null}
        {source === null ? (
          inputs.slice(-1).map((input) => renderField(input, inputs.length - 1))
        ) : (
          <div className="min-w-0 flex-1">
            <Input
              id={inputId(0)}
              font="mono"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder={source.referencePlaceholder}
              value={reference}
              disabled={locked}
              aria-invalid={error !== null || undefined}
              aria-describedby={describedBy}
              onChange={(event) => {
                setReference(event.currentTarget.value);
                setError(null);
              }}
            />
          </div>
        )}
        <Button type="submit" disabled={locked || incomplete}>
          <T>Send</T>
        </Button>
      </div>
      {error !== null ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex min-w-0 items-center justify-between gap-2">
        <p
          id={privacyId}
          className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden />
          {messages(SECRET_REQUEST_PRIVACY_NOTE)}
        </p>
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          disabled={locked}
          onClick={() => void send({ type: "decline" })}
        >
          <T>Decline</T>
        </Button>
      </div>
    </form>
  );
}

function SecretRequestField(props: {
  readonly id: string;
  readonly input: SecretRequestInput;
  readonly value: string;
  readonly disabled: boolean;
  readonly invalid: boolean;
  readonly describedBy: string;
  readonly showLabel: boolean;
  readonly onChange: (value: string) => void;
}) {
  const gt = useGT();
  const { input } = props;
  const [revealed, setRevealed] = useState(false);
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {props.showLabel ? (
        <label htmlFor={props.id} className="text-xs font-medium text-muted-foreground">
          {input.label}
        </label>
      ) : null}
      <InputGroup>
        <InputGroupInput
          id={props.id}
          // A CSS-masked text field still exposes its value to screen readers.
          type={input.masked && !revealed ? "password" : "text"}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          data-1p-ignore
          data-lpignore="true"
          data-bwignore
          placeholder={input.placeholder}
          value={props.value}
          disabled={props.disabled}
          aria-invalid={props.invalid || undefined}
          aria-describedby={props.describedBy}
          onChange={(event) => props.onChange(event.currentTarget.value)}
        />
        {input.masked ? (
          <InputGroupAddon align="inline-end">
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Show {label}", { label: input.label })}
              aria-pressed={revealed}
              disabled={props.disabled}
              // Keep focus, and the caret, in the input.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setRevealed((current) => !current)}
            >
              {revealed ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
            </Button>
          </InputGroupAddon>
        ) : null}
      </InputGroup>
    </div>
  );
}
