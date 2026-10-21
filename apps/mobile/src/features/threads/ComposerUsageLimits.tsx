import type { EnvironmentId, UsageLimitsReport } from "@supaterm/contracts";
import { Pressable, ScrollView, View } from "react-native";

import { SymbolView } from "../../components/ui/AppSymbol";
import { ResetCredits } from "../usage/ResetCredits";
import { AccountLimits } from "../usage/UsageLimitsSection";

const DRIVER_LABEL: Partial<Record<string, string>> = { codex: "Codex", claudeAgent: "Claude" };

export function ComposerUsageLimits({
  report,
  environmentId,
  maxHeight,
  onClose,
}: {
  readonly report: UsageLimitsReport;
  readonly environmentId: EnvironmentId;
  readonly maxHeight: number;
  readonly onClose: () => void;
}) {
  const now = Date.parse(report.createdAt);
  const close = (
    <Pressable
      accessibilityLabel="Dismiss usage limits"
      accessibilityRole="button"
      hitSlop={12}
      onPress={onClose}
      className="-me-1 p-1 active:opacity-60"
    >
      <SymbolView name="xmark" size={14} tintColorClassName="accent-icon-muted" type="monochrome" />
    </Pressable>
  );
  return (
    <View className="overflow-hidden rounded-[20px] border-continuous bg-card">
      <ScrollView bounces={false} showsVerticalScrollIndicator={false} style={{ maxHeight }}>
        {report.accounts.map((account, index) => {
          const driverLabel = DRIVER_LABEL[account.driver] ?? String(account.driver);
          return (
            <AccountLimits
              key={account.instanceId}
              dense
              first={index === 0}
              driver={account.driver}
              label={driverLabel}
              instanceLabel={
                account.displayName?.trim() ||
                (String(account.instanceId) !== String(account.driver)
                  ? account.instanceId
                  : driverLabel)
              }
              detail={account.plan}
              limits={account.limits}
              now={now}
              trailing={index === 0 ? close : undefined}
              footer={
                account.limits.resetCredits ? (
                  <ResetCredits
                    dense
                    environmentId={environmentId}
                    input={account.resetCreditInput ?? { instanceId: account.instanceId }}
                    credits={account.limits.resetCredits}
                    now={now}
                  />
                ) : undefined
              }
            />
          );
        })}
      </ScrollView>
    </View>
  );
}
