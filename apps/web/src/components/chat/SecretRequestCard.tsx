import { useAtomValue } from "@effect/atom-react";
import { pipe } from "effect/Function";
import {
  secretRequestAnswerInput,
  secretRequestDisplay,
  secretRequestFailureMessage,
  secretRequestInputs,
  secretRequestLink,
  SECRET_REQUEST_PRIVACY_NOTE,
  secretRequestValue,
  type SecretRequestInput,
  type SecretRequestItem,
  type SecretRequestReply,
} from "@supaterm/client-runtime/secret-request";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentId, OrchestrationV2ProjectedTurnItem } from "@supaterm/contracts";
import {
  CheckIcon,
  ClockIcon,
  ExternalLinkIcon,
  LockIcon,
  MinusIcon,
  ShieldCheckIcon,
} from "@supaterm/icons";
import { useId, useRef, useState, type FormEvent } from "react";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { WorkLogRow } from "./WorkLog";

export function SecretRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
  readonly visibility: OrchestrationV2ProjectedTurnItem["visibility"];
}) {
  const { item } = props;
  const display = secretRequestDisplay(item, props.visibility);
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

function PendingSecretRequestForm(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
}) {
  const { item } = props;
  const formId = useId();
  const inputs = secretRequestInputs(item);
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
    if (result._tag === "Success") return;
    if (reply.type === "save") setValues(reply.values);
    if (!isAtomCommandInterrupted(result)) {
      pipe(squashAtomCommandFailure(result), secretRequestFailureMessage, setError);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void send({ type: "save", values });
  };
  const incomplete = secretRequestAnswerInput(item, { type: "save", values }) === null;
  const link = secretRequestLink(item);
  const renderField = (input: SecretRequestInput, index: number) => (
    <SecretRequestField
      key={input.key}
      id={inputId(index)}
      input={input}
      value={secretRequestValue(values, input.key)}
      disabled={locked}
      invalid={error !== null}
      describedBy={error !== null ? `${privacyId} ${errorId}` : privacyId}
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
            Open {link.host}
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
        {inputs.slice(-1).map((input) => renderField(input, inputs.length - 1))}
        <Button type="submit" disabled={locked || incomplete}>
          Send
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
          {SECRET_REQUEST_PRIVACY_NOTE}
        </p>
        <Button
          type="button"
          size="xs"
          variant="ghost-muted"
          disabled={locked}
          onClick={() => void send({ type: "decline" })}
        >
          Decline
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
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      {props.showLabel ? (
        <label htmlFor={props.id} className="text-xs font-medium text-muted-foreground">
          {props.input.label}
        </label>
      ) : null}
      <Input
        id={props.id}
        // A CSS-masked text field still exposes its value to screen readers.
        type={props.input.masked ? "password" : "text"}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        data-bwignore
        placeholder={props.input.placeholder}
        value={props.value}
        disabled={props.disabled}
        aria-invalid={props.invalid || undefined}
        aria-describedby={props.describedBy}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </div>
  );
}
