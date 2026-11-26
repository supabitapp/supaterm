import type { ModelContextRecord } from "@supaterm/contracts";
import { BotIcon } from "@supaterm/icons";
import { useGT } from "gt-react";

import { ContextChipShell } from "./contextChipParts";

export function ModelContextChip(props: {
  record: Pick<ModelContextRecord, "label" | "providerName" | "model">;
  copyMarkdown?: string | undefined;
}) {
  const gt = useGT();
  const { label, providerName, model } = props.record;
  return (
    <ContextChipShell
      kind="model"
      icon={<BotIcon />}
      label={label}
      aria-label={gt("Model, {label}", { label })}
      data-markdown-copy={props.copyMarkdown}
      tooltip={`${providerName} · ${model}`}
    />
  );
}
