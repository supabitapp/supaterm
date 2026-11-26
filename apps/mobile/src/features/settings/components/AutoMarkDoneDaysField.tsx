import { useGT } from "gt-react-native";
import {
  MAX_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS,
} from "@supaterm/contracts";
import type { ComponentProps } from "react";
import { NumberField } from "../../../components/ui/NumberField";

export type AutoMarkDoneDaysFieldProps = Pick<
  ComponentProps<typeof NumberField>,
  "value" | "onValueChange" | "disabled"
>;

export function AutoMarkDoneDaysField(props: AutoMarkDoneDaysFieldProps) {
  const gt = useGT();
  return (
    <NumberField
      {...props}
      min={MIN_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS}
      max={MAX_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS}
      label={gt("Days before automatically marking as Done")}
      formatValue={(value) =>
        gt("{count, plural, one {{count} day} other {{count} days}}", { count: value })
      }
    />
  );
}
