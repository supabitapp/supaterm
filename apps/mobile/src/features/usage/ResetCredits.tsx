import type {
  EnvironmentId,
  ProviderConsumeResetCreditInput,
  ProviderConsumeResetCreditOutcome,
  ServerProviderResetCredits,
} from "@supaterm/contracts";
import { type ResetCreditChoice, resetCreditChoices } from "@supaterm/shared/usageLimits";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import { useInlineConfirm } from "../../lib/useInlineConfirm";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

const OUTCOME_TEXT: Record<ProviderConsumeResetCreditOutcome, string> = {
  reset: "Reset applied. Your windows have cleared.",
  nothingToReset: "Nothing to reset right now.",
  noCredit: "No reset credit left.",
  alreadyRedeemed: "That credit was already redeemed.",
};

/**
 * Banked reset credits with a confirmed redeem action. Redeeming spends a
 * credit the provider granted the user, so it asks for a second tap rather
 * than firing on a bare tap.
 */
export function ResetCredits(props: {
  readonly environmentId: EnvironmentId;
  readonly input: ProviderConsumeResetCreditInput;
  readonly credits: ServerProviderResetCredits;
  readonly now: number;
  /** A smaller pill for the composer card. */
  readonly dense?: boolean;
}) {
  const { environmentId, input, credits, now, dense = false } = props;
  const consume = useAtomCommand(serverEnvironment.consumeResetCredit, {
    reportFailure: false,
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const confirm = useInlineConfirm<string>();
  if (dense && credits.availableCount === 0 && status === null) return null;

  const choices = resetCreditChoices(credits, input, now);
  const armedChoice = choices.find((choice) => choice.key === confirm.armed);

  const redeem = async (choice: ResetCreditChoice) => {
    setBusy(true);
    setStatus(null);
    const result = await consume({ environmentId, input: choice.input });
    setBusy(false);
    if (result._tag === "Success") {
      setStatus(result.value.warning ?? OUTCOME_TEXT[result.value.outcome]);
      return;
    }
    setStatus(
      "error" in result.cause && result.cause.error instanceof Error
        ? result.cause.error.message
        : "Could not use the reset credit.",
    );
  };

  return (
    <View className="gap-1">
      {choices.map((choice) => (
        <View key={choice.key} className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <Text className="text-xs tabular-nums text-foreground-tertiary">{choice.summary}</Text>
          {choice.availableCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              {...confirm.bind(choice.key, () => void redeem(choice))}
              className={
                dense
                  ? "rounded-full bg-subtle-strong px-2.5 py-1"
                  : "min-h-[44px] justify-center rounded-full bg-subtle-strong px-3 py-1.5"
              }
            >
              <Text
                className={
                  dense
                    ? "text-xs font-supaterm-medium text-foreground"
                    : "text-sm font-supaterm-medium text-foreground"
                }
              >
                {busy
                  ? "Using…"
                  : confirm.armed === choice.key
                    ? "Confirm reset"
                    : choice.actionLabel}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}
      {armedChoice ? (
        <Text className="text-sm text-foreground-muted">{armedChoice.confirmDescription}</Text>
      ) : status ? (
        <Text className="text-sm text-foreground">{status}</Text>
      ) : null}
    </View>
  );
}
