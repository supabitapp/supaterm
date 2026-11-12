import { useAtomValue } from "@effect/atom-react";
import { pipe } from "effect/Function";
import {
  secretRequestAnswerInput,
  secretRequestDisplay,
  secretRequestFailureMessage,
  secretRequestInputs,
  SECRET_REQUEST_PRIVACY_NOTE,
  secretRequestLink,
  secretRequestValue,
  type SecretRequestItem,
  type SecretRequestReply,
} from "@supaterm/client-runtime/secret-request";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import type { EnvironmentId, OrchestrationV2ProjectedTurnItem } from "@supaterm/contracts";
import { useRef, useState } from "react";
import { View, type ColorValue } from "react-native";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { SecretTextInput } from "../../components/ui/SecretTextInput";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { Button } from "../../components/ui/Button";

const LOCK_SYMBOL: AppSymbolName = { ios: "lock", android: "lock" };
const PRIVATE_SYMBOL: AppSymbolName = { ios: "checkmark.shield", android: "lock" };
const EXPIRED_SYMBOL: AppSymbolName = "clock";

export function SecretRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly iconColor: ColorValue;
}) {
  const { item, visibility } = props.projectedItem;
  if (item.type !== "secret_request") return null;
  const display = secretRequestDisplay(item, visibility);
  if (display.kind === "pending") {
    return (
      <PendingSecretRequestForm
        environmentId={props.environmentId}
        item={item}
        iconColor={props.iconColor}
      />
    );
  }
  if (display.kind === "expired") {
    return (
      <View className="mb-3 flex-row items-start gap-2.5 rounded-[20px] border border-border bg-card-alt p-4">
        <View className="pt-0.5">
          <SymbolView
            name={EXPIRED_SYMBOL}
            size={15}
            tintColor={props.iconColor}
            type="monochrome"
          />
        </View>
        <View className="flex-1 gap-1">
          <Text className="font-supaterm-bold text-base text-foreground">
            {item.label} · {display.label}
          </Text>
          <Text className="font-sans text-sm leading-5 text-foreground-muted">{display.hint}</Text>
        </View>
      </View>
    );
  }
  const icon: AppSymbolName =
    display.kind === "pending-elsewhere"
      ? LOCK_SYMBOL
      : display.outcome === "saved"
        ? "checkmark"
        : "minus";
  return (
    <View className="mb-3 min-h-9 flex-row items-center gap-2 px-1">
      <SymbolView name={icon} size={13} tintColor={props.iconColor} type="monochrome" />
      <Text className="flex-1 font-sans text-sm text-foreground-muted" numberOfLines={2}>
        {item.label} · {display.label}
      </Text>
    </View>
  );
}

function PendingSecretRequestForm(props: {
  readonly environmentId: EnvironmentId;
  readonly item: SecretRequestItem;
  readonly iconColor: ColorValue;
}) {
  const { item } = props;
  const answer = useAtomCommand(serverEnvironment.answerSecretRequest, {
    label: "answer secret request",
    // The failure cause holds the request; keep it out of the console.
    reportFailure: false,
    reportDefect: false,
  });
  const canAnswer = useAtomValue(
    serverEnvironment.answerSecretRequest.permissionAtom(props.environmentId),
  );
  const inputs = secretRequestInputs(item);
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const locked = submitting || !canAnswer;
  const [error, setError] = useState<string | null>(null);
  // Submit then a tap can both run before a re-render; this guard is synchronous.
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
  const link = secretRequestLink(item);

  return (
    <View className="mb-3 gap-3 rounded-[20px] border border-border bg-card-alt p-4">
      <View className="gap-1">
        <Text className="font-supaterm-bold text-base text-foreground">{item.label}</Text>
        {item.reason.trim() ? (
          <Text className="font-sans text-sm leading-5 text-foreground-muted" selectable>
            {item.reason}
          </Text>
        ) : null}
      </View>
      {link !== null ? (
        <View className="gap-1.5">
          <Button
            label={`Open ${link.host}`}
            tone="secondary"
            fullWidth
            onPress={() => void tryOpenExternalUrl(link.href, "secret-request")}
          />
          {/* A link found in the reason is already shown there. */}
          {item.url !== undefined ? (
            <Text selectable className="font-mono text-xs text-foreground-muted">
              {item.url}
            </Text>
          ) : null}
        </View>
      ) : null}
      {inputs.map((input) => {
        const value = secretRequestValue(values, input.key);
        const onChangeText = (next: string) =>
          setValues((current) => ({ ...current, [input.key]: next }));
        // The field's own text, so a submit never uses a stale render of it.
        const onSubmit = (next: string) =>
          void send({ type: "save", values: { ...values, [input.key]: next } });
        return (
          <View key={input.key} className="gap-1.5">
            {item.fields === undefined ? null : (
              <Text className="font-sans text-xs text-foreground-muted">{input.label}</Text>
            )}
            {input.masked ? (
              <SecretTextInput
                accessibilityLabel={input.label}
                placeholder={input.placeholder}
                value={value}
                onChangeText={onChangeText}
                editable={!locked}
                onSubmitEditing={onSubmit}
              />
            ) : (
              <AppTextInput
                accessibilityLabel={input.label}
                placeholder={input.placeholder}
                value={value}
                onChangeText={onChangeText}
                editable={!locked}
                autoCorrect={false}
                autoCapitalize="none"
                autoComplete="off"
                textContentType="none"
                importantForAutofill="no"
                spellCheck={false}
                returnKeyType="done"
                onSubmitEditing={(event) => onSubmit(event.nativeEvent.text)}
              />
            )}
          </View>
        );
      })}
      {error !== null ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="font-sans text-sm text-danger-foreground"
        >
          {error}
        </Text>
      ) : null}
      <Button
        label="Send"
        tone="primary"
        fullWidth
        disabled={locked || secretRequestAnswerInput(item, { type: "save", values }) === null}
        onPress={() => void send({ type: "save", values })}
      />
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-1 flex-row items-center gap-1.5">
          <SymbolView
            name={PRIVATE_SYMBOL}
            size={13}
            tintColor={props.iconColor}
            type="monochrome"
          />
          <Text className="flex-1 font-sans text-xs text-foreground-muted">
            {SECRET_REQUEST_PRIVACY_NOTE}
          </Text>
        </View>
        <Button
          label="Decline"
          tone="text"
          disabled={locked}
          onPress={() => void send({ type: "decline" })}
        />
      </View>
    </View>
  );
}
