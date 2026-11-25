import {
  AuthProvidersManageScope,
  SecretReference,
  type EnvironmentId,
  type SecretProviderConfig,
  type SecretProviderId,
  type SecretProviderKind,
} from "@supaterm/contracts";
import { KeyIcon, TypeIcon, VaultIcon } from "@supaterm/icons";
import { builtInSecretProviderDefinitions } from "@supaterm/secret-provider-definitions/registry";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useState, type ComponentProps, type ComponentType, type ReactNode } from "react";

import { useEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useEnvironmentScope } from "../../state/session";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SecretInput } from "./SecretInput";
import { classifySecretProvider } from "./SecretProviderDialog.logic";

export interface SecretSource {
  readonly id: SecretProviderId;
  readonly kind: SecretProviderKind;
  readonly label: string;
}

const NO_SECRET_SOURCES: ReadonlyArray<SecretSource> = [];
const STORED_VALUE = "__stored__";
const decodeSecretReference = Schema.decodeUnknownOption(SecretReference);

/**
 * Secret providers a setting can point at; empty when the environment cannot read references or
 * this session may not save one, which needs provider management.
 */
export function useSecretSources(environmentId: EnvironmentId): ReadonlyArray<SecretSource> {
  const providers = useEnvironmentSettings(environmentId, (settings) => settings.secretProviders);
  const supported = useAtomValue(
    serverEnvironment.configValueAtom(environmentId),
    (config) => config?.secretProviderSettings === true && config.secretReferences === true,
  );
  const canManageProviders = useEnvironmentScope(environmentId, AuthProvidersManageScope);
  if (!supported || !canManageProviders) return NO_SECRET_SOURCES;
  return (Object.entries(providers) as Array<[SecretProviderId, SecretProviderConfig]>)
    .filter(([, config]) => classifySecretProvider(config).kind !== "unsupported")
    .map(([id, config]) => ({ id, kind: config.kind, label: config.label }));
}

function SourceIcon(props: { readonly icon: ComponentType<{ readonly className?: string }> }) {
  return <props.icon className="size-3.5 shrink-0" />;
}

function SourceLabel(props: {
  readonly icon: ComponentType<{ readonly className?: string }>;
  readonly label: string;
}) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <props.icon className="size-3.5 shrink-0" />
      <span className="truncate">{props.label}</span>
    </span>
  );
}

/** Picks Value (`null`) or one of `sources`; a `value` no longer among them stays listed. */
export function SecretSourceSelect(props: {
  readonly value: SecretProviderId | null;
  readonly sources: ReadonlyArray<Pick<SecretSource, "id" | "label">>;
  readonly label: string;
  readonly disabled?: boolean;
  readonly onValueChange: (provider: SecretProviderId | null) => void;
}) {
  const { value, sources } = props;
  const known = value === null || sources.some((source) => source.id === value);
  const title =
    value === null ? "Value" : (sources.find((source) => source.id === value)?.label ?? value);
  return (
    <Select
      value={value ?? STORED_VALUE}
      onValueChange={(next) =>
        props.onValueChange(
          next === STORED_VALUE || next === null ? null : (next as SecretProviderId),
        )
      }
      {...(props.disabled === undefined ? {} : { disabled: props.disabled })}
    >
      <SelectTrigger
        size="sm"
        className="w-auto min-w-0 shrink-0"
        aria-label={`${props.label} source`}
        title={title}
      >
        <SelectValue>
          <SourceIcon icon={value === null ? TypeIcon : known ? VaultIcon : KeyIcon} />
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="start" alignItemWithTrigger={false}>
        <SelectItem value={STORED_VALUE}>
          <SourceLabel icon={TypeIcon} label="Value" />
        </SelectItem>
        {sources.map((source) => (
          <SelectItem key={source.id} value={source.id}>
            <SourceLabel icon={VaultIcon} label={source.label} />
          </SelectItem>
        ))}
        {known ? null : (
          <SelectItem value={value}>
            <SourceLabel icon={KeyIcon} label={value} />
          </SelectItem>
        )}
      </SelectPopup>
    </Select>
  );
}

type SecretSourceInputProps = Omit<ComponentProps<typeof SecretInput>, "value" | "children"> & {
  readonly value: string | SecretReference;
  /** Offers a check of the committed reference on this environment. */
  readonly environmentId?: EnvironmentId | undefined;
  readonly sources: ReadonlyArray<SecretSource>;
  readonly onSecretChange: (secret: SecretReference | undefined) => void;
  /** Whether the selected source and committed field can be saved or used. */
  readonly onValidityChange?: (valid: boolean) => void;
  /** Places the parts in the caller's layout; `source` is null when there is nothing to pick. */
  readonly children?: (parts: {
    readonly source: ReactNode;
    readonly value: ReactNode;
  }) => ReactNode;
};

/** A secret entered here, or read from a secret provider when one is configured. */
export function SecretSourceInput({
  value,
  environmentId: _environmentId,
  sources,
  onSecretChange,
  onValidityChange,
  children,
  ...rest
}: SecretSourceInputProps) {
  // A provider picked here applies once a reference for it is committed.
  const [pendingProvider, setPendingProvider] = useState<SecretProviderId | null>(null);
  const [rejectedReference, setRejectedReference] = useState<string | null>(null);
  const secret = typeof value === "string" ? undefined : value;
  const input = { ...rest, value: typeof value === "string" ? value : "" };
  const provider = pendingProvider ?? secret?.provider ?? null;
  const reference = secret !== undefined && secret.provider === provider ? secret.reference : "";
  const providerSource = sources.find((source) => source.id === provider);
  const definition = providerSource && builtInSecretProviderDefinitions.find(providerSource.kind);
  const label = input["aria-label"] ?? "Secret";
  const source =
    sources.length === 0 && provider === null ? null : (
      <SecretSourceSelect
        value={provider}
        sources={sources}
        label={label}
        onValueChange={(next) => {
          setRejectedReference(null);
          if (next === null) {
            setPendingProvider(null);
            onValidityChange?.(true);
            if (secret !== undefined) onSecretChange(undefined);
            return;
          }
          onValidityChange?.(next === secret?.provider);
          setPendingProvider(next === secret?.provider ? null : next);
        }}
      />
    );

  const valueField =
    provider === null ? (
      <SecretInput {...input} />
    ) : (
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <DraftInput
            {...(input.id !== undefined ? { id: input.id } : {})}
            size="sm"
            font="mono"
            className="min-w-0 flex-1"
            value={rejectedReference ?? reference}
            onCommit={(next) => {
              if (next.trim().length === 0) {
                setRejectedReference(null);
                onValidityChange?.(pendingProvider === null && secret !== undefined);
                if (pendingProvider === null && secret !== undefined) onSecretChange(undefined);
                return;
              }
              const decoded = decodeSecretReference({ provider, reference: next });
              if (
                Option.isNone(decoded) ||
                definition?.isReference(decoded.value.reference) === false
              ) {
                setRejectedReference(next);
                onValidityChange?.(false);
                return;
              }
              setRejectedReference(null);
              setPendingProvider(null);
              onValidityChange?.(true);
              onSecretChange(decoded.value);
            }}
            autoComplete="off"
            placeholder={definition?.referencePlaceholder}
            spellCheck={false}
            aria-label={`${label} reference`}
            aria-invalid={rejectedReference !== null}
          />
        </div>
        {rejectedReference !== null ? (
          <p className="text-2xs text-destructive">
            {definition ? definition.invalidReferenceMessage : "Enter a valid secret reference."}
          </p>
        ) : null}
      </div>
    );

  if (children !== undefined) return children({ source, value: valueField });
  if (source === null) return valueField;
  return (
    <div className="flex min-w-0 flex-1 items-start gap-1.5">
      {source}
      {valueField}
    </div>
  );
}
