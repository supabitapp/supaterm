import { pipe } from "effect/Function";
import { useAtomValue } from "@effect/atom-react";
import {
  linkRequestAnswerInput,
  linkRequestDefaultAccess,
  linkRequestDisplay,
  linkRequestFailureMessage,
  linkRequestInitialMachine,
  type LinkRequestItem,
  linkRequestTarget,
  linkRequestTargetName,
  rankMachinesByHint,
} from "@supaterm/client-runtime/link-request";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  AuthAccessWriteScope,
  type AuthMcpClientAccess,
  type EnvironmentId,
  type OrchestrationV2ProjectedTurnItem,
} from "@supaterm/contracts";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import { useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, View, type ColorValue } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SymbolView, type AppSymbolName } from "../../components/ui/AppSymbol";
import { AppText as Text, AppTextInput as TextInput } from "../../components/ui/AppText";
import { peerLinkEnvironment, useLinkableMachines } from "../../state/peerLinks";
import { mintPairingCodeOn } from "../../state/peerPairingCode";
import { useEnvironmentScope, usePreparedConnection } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { LinkAccessPicker, linkAccessLabel } from "../connection/LinkAccessPicker";
import { LinkAddressWarning, LinkMachineSelect } from "../connection/LinkMachineSelect";

const LINK_SYMBOL: AppSymbolName = { ios: "link", android: "desktop_windows" };

/** Whether the agent left the machine for the user to pick. */
const picksMachine = (item: LinkRequestItem) =>
  item.environmentId === undefined && item.url === undefined;

/**
 * Feed card for a link an agent asked the user to make. The user picks the
 * access in a sheet; the pairing code lives only in that sheet's state and
 * the RPC payload, and is never logged, alerted, or persisted.
 */
export function LinkRequestCard(props: {
  readonly environmentId: EnvironmentId;
  readonly projectedItem: OrchestrationV2ProjectedTurnItem;
  readonly iconColor: ColorValue;
}) {
  const { item, visibility } = props.projectedItem;
  if (item.type !== "link_request") return null;
  const display = linkRequestDisplay(item, visibility, linkAccessLabel);
  if (display.kind === "pending") {
    return <PendingLinkRequest environmentId={props.environmentId} item={item} />;
  }
  const icon: AppSymbolName =
    display.kind === "pending-elsewhere"
      ? LINK_SYMBOL
      : display.outcome === "linked"
        ? "checkmark"
        : display.outcome === "failed"
          ? "xmark"
          : "minus";
  return (
    <View className="mb-3 min-h-9 flex-row items-center gap-2 px-1">
      <SymbolView name={icon} size={13} tintColor={props.iconColor} type="monochrome" />
      <Text className="flex-1 font-sans text-sm text-foreground-muted" numberOfLines={2}>
        {display.label}
      </Text>
    </View>
  );
}

function PendingLinkRequest(props: {
  readonly environmentId: EnvironmentId;
  readonly item: LinkRequestItem;
}) {
  const { item } = props;
  const [open, setOpen] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = useAtomCommand(peerLinkEnvironment.answerRequest, {
    label: "decline link request",
    reportFailure: false,
    reportDefect: false,
  });
  const canAnswer = useAtomValue(
    peerLinkEnvironment.answerRequest.permissionAtom(props.environmentId),
  );
  const target = linkRequestTargetName(item);

  const decline = async () => {
    const input = linkRequestAnswerInput(item, { type: "decline" });
    if (input === null) return;
    setDeclining(true);
    setError(null);
    const result = await answer({ environmentId: props.environmentId, input }).finally(() =>
      setDeclining(false),
    );
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      pipe(squashAtomCommandFailure(result), linkRequestFailureMessage, setError);
    }
  };

  return (
    <View className="mb-3 gap-3 rounded-[20px] border border-border bg-card-alt p-4">
      <View className="gap-1">
        <Text className="font-supaterm-bold text-base text-foreground">
          {picksMachine(item)
            ? "Link a machine to this environment"
            : `Link ${target} to this environment`}
        </Text>
        {item.reason.trim() ? (
          <Text className="font-sans text-sm leading-5 text-foreground-muted">{item.reason}</Text>
        ) : null}
      </View>
      {error !== null ? (
        <Text
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          className="font-sans text-sm text-danger-foreground"
        >
          {error}
        </Text>
      ) : null}
      {canAnswer ? (
        <>
          <Button
            label={picksMachine(item) ? "Choose machine…" : "Review link…"}
            disabled={declining}
            onPress={() => setOpen(true)}
            tone="primary"
            fullWidth
          />
          <View className="flex-row justify-end">
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: declining }}
              disabled={declining}
              hitSlop={8}
              className="px-1 py-1 active:opacity-60 disabled:opacity-50"
              onPress={() => void decline()}
            >
              <Text className="font-sans text-xs text-foreground-muted">Decline</Text>
            </Pressable>
          </View>
        </>
      ) : (
        <Text className="font-sans text-xs text-foreground-muted">
          Only a session that manages access here can answer this.
        </Text>
      )}
      {open ? (
        <LinkRequestSheet
          environmentId={props.environmentId}
          item={item}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </View>
  );
}

function LinkRequestSheet(props: {
  readonly environmentId: EnvironmentId;
  readonly item: LinkRequestItem;
  readonly onClose: () => void;
}) {
  const { item } = props;
  const insets = useSafeAreaInsets();
  const pickMachine = picksMachine(item);
  const listed = useLinkableMachines(props.environmentId, true);
  const machines = useMemo(() => rankMachinesByHint(listed, item.hint), [listed, item.hint]);
  const [choice, setChoice] = useState<string | null>(null);
  const [address, setAddress] = useState(item.url ?? "");
  const [access, setAccess] = useState<AuthMcpClientAccess>(() => linkRequestDefaultAccess(item));
  const [pairingCode, setPairingCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mintFailed, setMintFailed] = useState<ReadonlySet<EnvironmentId>>(new Set());
  // Submit then a tap can both run before a re-render; this guard is synchronous.
  const inFlight = useRef(false);
  const answer = useAtomCommand(peerLinkEnvironment.answerRequest, {
    label: "answer link request",
    // The failure cause holds the request, and with it the code; keep it out of the console.
    reportFailure: false,
    reportDefect: false,
  });
  const selected = choice ?? linkRequestInitialMachine(item, machines);
  const target = linkRequestTarget(item, machines, selected);
  const targetName = target.kind === "machine" ? target.label : linkRequestTargetName(item);
  const targetId = target.kind === "machine" ? target.environmentId : null;
  const connected = usePreparedConnection(targetId);
  const mayMint = useEnvironmentScope(targetId, AuthAccessWriteScope);
  const needsAddress =
    target.kind === "address" || (target.kind === "machine" && target.urls.length === 0);
  // This phone mints a code there when it is connected with a session that may
  // create pairing links, and only for its own addresses: anything can answer
  // as that machine at one typed in, so that one gets a code the user fetched.
  const canMint =
    targetId !== null &&
    !needsAddress &&
    Option.isSome(connected) &&
    mayMint &&
    !mintFailed.has(targetId);
  const useExisting = target.kind === "machine" && target.linked;
  const ready =
    target.kind !== "none" &&
    (useExisting ||
      ((!needsAddress || address.trim().length > 0) && (canMint || pairingCode.trim().length > 0)));

  const prepareAnswer = async () => {
    if (target.kind === "none") return null;
    if (target.kind === "machine" && target.linked) {
      return linkRequestAnswerInput(item, {
        type: "use-existing",
        environmentId: target.environmentId,
      });
    }
    let code = pairingCode;
    if (canMint && targetId !== null) {
      const minted = await mintPairingCodeOn(targetId, access);
      if (Result.isFailure(minted)) {
        setMintFailed((failed) => new Set(failed).add(targetId));
        setError(linkRequestFailureMessage(minted.failure));
        return null;
      }
      code = minted.success;
    }
    return linkRequestAnswerInput(item, {
      type: "link",
      target: target.kind === "machine" && target.urls.length > 0 ? target : { url: address },
      access,
      pairingCode: code,
    });
  };

  const submit = async () => {
    if (inFlight.current || target.kind === "none") return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const input = await prepareAnswer();
    const result =
      input === null ? null : await answer({ environmentId: props.environmentId, input });
    inFlight.current = false;
    setBusy(false);
    if (result === null) return;
    if (result._tag === "Success") {
      setPairingCode("");
      props.onClose();
    } else if (!isAtomCommandInterrupted(result)) {
      pipe(squashAtomCommandFailure(result), linkRequestFailureMessage, setError);
    }
  };

  return (
    <Sheet
      title={pickMachine ? "Link a machine" : `Link ${targetName}`}
      onClose={props.onClose}
      // An answer that lands after a close would still link, and would close a reopened sheet.
      dismissDisabled={busy}
    >
      <ScrollView
        className="flex-1 bg-sheet-solid"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 p-5"
        contentContainerStyle={{ paddingBottom: insets.bottom + 20 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="gap-1">
          <Text className="font-sans text-sm leading-5 text-foreground-muted">
            Agents here can then launch, message and wait on threads there. It appears in that
            machine's Sharing & access, where it can be revoked.
          </Text>
          {item.url !== undefined && target.kind === "machine" ? (
            <Text className="font-sans text-xs text-foreground-muted" numberOfLines={1}>
              {item.url}
            </Text>
          ) : null}
        </View>
        {needsAddress && !useExisting && address.trim() ? (
          <LinkAddressWarning address={address} />
        ) : null}
        {pickMachine ? (
          <LinkMachineSelect
            machines={machines}
            value={selected}
            disabled={busy}
            onChange={(value) => {
              setChoice(value);
              setError(null);
            }}
          />
        ) : null}
        {needsAddress && item.url === undefined ? (
          <View className="gap-2">
            <TextInput
              accessibilityLabel="Address"
              placeholder="https://machine.tailnet.ts.net"
              value={address}
              onChangeText={setAddress}
              editable={!busy}
              autoCorrect={false}
              autoCapitalize="none"
              keyboardType="url"
              spellCheck={false}
            />
            {target.kind === "machine" ? (
              <Text className="font-sans text-xs text-foreground-muted">
                This app has no address for {target.label} that another machine can reach. Enter its
                https or Tailscale address.
              </Text>
            ) : null}
          </View>
        ) : null}
        {useExisting ? (
          <Text className="font-sans text-sm leading-5 text-foreground-muted">
            This environment is already linked to {targetName}. The agent can use that link as it
            is; change its access in Settings → Environments.
          </Text>
        ) : target.kind === "none" ? null : (
          <>
            {canMint ? null : (
              <View className="gap-2">
                <TextInput
                  accessibilityLabel="Pairing code"
                  placeholder="Paste the code"
                  value={pairingCode}
                  onChangeText={setPairingCode}
                  editable={!busy}
                  autoCorrect={false}
                  autoCapitalize="none"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  spellCheck={false}
                />
                <Text className="font-sans text-xs text-foreground-muted">
                  Create a link on {targetName}: Settings → Sharing & access → Add device, then
                  paste its code here.
                </Text>
              </View>
            )}
            <LinkAccessPicker value={access} disabled={busy} onChange={setAccess} />
          </>
        )}
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
          label={busy ? "Linking…" : useExisting ? "Use this link" : "Link"}
          disabled={busy || !ready}
          onPress={() => void submit()}
          tone="primary"
          fullWidth
        />
        <Button label="Cancel" tone="secondary" disabled={busy} onPress={props.onClose} fullWidth />
      </ScrollView>
    </Sheet>
  );
}
