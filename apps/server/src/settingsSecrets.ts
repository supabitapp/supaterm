import {
  AntigravitySettings,
  ClaudeSettings,
  CloudSpeechCredentials,
  CodexSettings,
  EasDeviceHostConfig,
  type ProviderInstanceConfig,
  type ServerSettings,
  type SettingsSecretValue,
  isSecretReference,
  secretSettingsFields,
} from "@supaterm/contracts";
import { acpRegistryClient } from "@supaterm/provider-acp-registry/client";
import { cursorClient } from "@supaterm/provider-cursor/client";
import { grokClient } from "@supaterm/provider-grok/client";
import { kiroClient } from "@supaterm/provider-kiro/client";
import { museClient } from "@supaterm/provider-muse/client";
import { openCodeClient } from "@supaterm/provider-opencode/client";
import { piClient } from "@supaterm/provider-pi/client";
import {
  readSecretFieldValues,
  SOURCE_CONTROL_HOST_SECRET_FIELDS,
  sourceControlHostSecretName,
  writeSecretFieldValues,
} from "./sourceControl/sourceControlHostSecrets.ts";

export const SECRET_REDACTED = "\u2022\u2022\u2022\u2022\u2022\u2022";

const providerSecretFields = new Map([
  ["codex", secretSettingsFields(CodexSettings)],
  ["claudeAgent", secretSettingsFields(ClaudeSettings)],
  ["antigravity", secretSettingsFields(AntigravitySettings)],
  ...[
    cursorClient,
    grokClient,
    kiroClient,
    museClient,
    openCodeClient,
    piClient,
    acpRegistryClient,
  ].map(
    (definition) =>
      [definition.driverKind, secretSettingsFields(definition.settingsSchema)] as const,
  ),
]);
const voiceSecretFields = secretSettingsFields(CloudSpeechCredentials);
const easDeviceHostSecretFields = secretSettingsFields(EasDeviceHostConfig);
const encode = (value: string) => Buffer.from(value, "utf8").toString("base64url");

export interface SettingsSecret {
  readonly secretName: string;
  readonly kind: "field" | "environment";
  readonly value: string;
  readonly redacted: boolean;
  readonly sensitive: boolean;
  readonly providerInstanceId?: string;
  readonly environmentVariable?: string;
}

type SecretValue = Pick<SettingsSecret, "value" | "redacted">;
type SecretSlotName = (field: string, serverHost: string | null) => string;
type SecretFieldsMapper = (
  fields: Readonly<Record<string, unknown>>,
  secretFields: ReadonlyArray<string>,
  name: SecretSlotName,
) => Record<string, unknown>;
type ProviderEnvironment = NonNullable<ProviderInstanceConfig["environment"]>;
const environmentSecretName = (instanceId: string, variableName: string) =>
  `provider-env-${encode(instanceId)}-${encode(variableName)}`;

export function mapSettingsSecrets(
  settings: ServerSettings,
  map: (secret: SettingsSecret) => SecretValue,
): ServerSettings {
  const mapFields: SecretFieldsMapper = (fields, secretFields, name) => {
    const next = { ...fields };
    for (const field of secretFields) {
      if (!(field in next) || isSecretReference(next[field])) continue;
      next[field] = writeSecretFieldValues(
        next[field],
        readSecretFieldValues(next[field]).map(([serverHost, value]) => {
          const result = map({
            secretName: name(field, serverHost),
            kind: "field",
            value,
            redacted: value === SECRET_REDACTED,
            sensitive: true,
          });
          return [serverHost, result.redacted ? SECRET_REDACTED : result.value] as const;
        }),
      );
    }
    return next;
  };

  return mapSecretFieldGroups(settings, mapFields, (instanceId, environment) =>
    environment.map((variable) => {
      const { valueRedacted: _omit, ...rest } = variable;
      // A secret reference is not itself secret; storage sees the value cleared.
      const reference = typeof variable.value === "string" ? undefined : variable.value;
      const result = map({
        secretName: environmentSecretName(instanceId, variable.name),
        kind: "environment",
        value: typeof variable.value === "string" ? variable.value : "",
        redacted: reference === undefined && variable.valueRedacted === true,
        sensitive: variable.sensitive,
        providerInstanceId: instanceId,
        environmentVariable: variable.name,
      });
      if (reference !== undefined) return { ...rest, value: reference };
      return {
        ...rest,
        value: result.value,
        ...(result.redacted ? { valueRedacted: true } : {}),
      };
    }),
  );
}

/**
 * Maps each value a secret field holds, literal or reference, with the secret name of its slot.
 * Provider environment variables are left as they are.
 */
export function mapSettingsSecretValues(
  settings: ServerSettings,
  map: (value: SettingsSecretValue, secretName: string) => SettingsSecretValue,
): ServerSettings {
  const mapValue = (value: unknown, secretName: string) =>
    typeof value === "string" || isSecretReference(value) ? map(value, secretName) : value;
  return mapSecretFieldGroups(settings, (fields, secretFields, name) => {
    const next = { ...fields };
    for (const field of secretFields) {
      if (!(field in next)) continue;
      const value = next[field];
      next[field] =
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        !isSecretReference(value)
          ? Object.fromEntries(
              Object.entries(value).map(([serverHost, entry]) => [
                serverHost,
                mapValue(entry, name(field, serverHost.trim().toLowerCase())),
              ]),
            )
          : mapValue(value, name(field, null));
    }
    return next;
  });
}

/** Maps each provider environment variable with the secret name of its slot. */
export function mapProviderEnvironmentVariables(
  settings: ServerSettings,
  map: (variable: ProviderEnvironment[number], secretName: string) => ProviderEnvironment[number],
): ServerSettings {
  return mapSecretFieldGroups(
    settings,
    (fields) => fields,
    (instanceId, environment) =>
      environment.map((variable) =>
        map(variable, environmentSecretName(instanceId, variable.name)),
      ),
  );
}

function mapSecretFieldGroups(
  settings: ServerSettings,
  mapFields: SecretFieldsMapper,
  mapEnvironment: (instanceId: string, environment: ProviderEnvironment) => ProviderEnvironment = (
    _instanceId,
    environment,
  ) => environment,
): ServerSettings {
  const providerInstances = Object.fromEntries(
    Object.entries(settings.providerInstances).map(([instanceId, instance]) => {
      const config = instance.config;
      return [
        instanceId,
        {
          ...instance,
          ...(config !== null && typeof config === "object" && !Array.isArray(config)
            ? {
                config: mapFields(
                  config as Record<string, unknown>,
                  providerSecretFields.get(instance.driver) ?? [],
                  (field, serverHost) =>
                    `provider-config-${encode(instanceId)}-${encode(instance.driver)}-${encode(field)}` +
                    (serverHost === null ? "" : `-${encode(serverHost)}`),
                ),
              }
            : {}),
          ...(instance.environment
            ? { environment: mapEnvironment(instanceId, instance.environment) }
            : {}),
        },
      ];
    }),
  );

  const sourceControlHosts = Object.fromEntries(
    Object.entries(settings.sourceControlHosts).map(([kind, fields]) => [
      kind,
      mapFields(fields, SOURCE_CONTROL_HOST_SECRET_FIELDS.get(kind) ?? [], (field, serverHost) =>
        sourceControlHostSecretName({ kind, field, serverHost }),
      ),
    ]),
  ) as ServerSettings["sourceControlHosts"];

  const easDeviceHosts = settings.easDeviceHosts.map(
    (host) =>
      mapFields(
        host,
        easDeviceHostSecretFields,
        (field, serverHost) =>
          `device-host-${encode(host.id)}-${encode(field)}` +
          (serverHost === null ? "" : `-${encode(serverHost)}`),
      ) as EasDeviceHostConfig,
  );

  return {
    ...settings,
    cloudSpeechCredentials: mapFields(
      settings.cloudSpeechCredentials,
      voiceSecretFields,
      (provider) => `voice-cloud-${provider}`,
    ) as ServerSettings["cloudSpeechCredentials"],
    providerInstances,
    sourceControlHosts,
    easDeviceHosts,
  };
}

/**
 * `next` with every secret reference to a secret provider that `current` has and `next` dropped
 * unset: a credential field becomes empty, and a provider variable holding one is removed.
 */
export function withoutRemovedSecretProviderReferences(
  current: ServerSettings,
  next: ServerSettings,
): ServerSettings {
  const removed = new Set(
    Object.keys(current.secretProviders).filter((id) => !Object.hasOwn(next.secretProviders, id)),
  );
  if (removed.size === 0) return next;
  const isRemoved = (value: unknown) => isSecretReference(value) && removed.has(value.provider);
  const fields = mapSettingsSecretValues(next, (value) => (isRemoved(value) ? "" : value));
  return {
    ...fields,
    providerInstances: Object.fromEntries(
      Object.entries(fields.providerInstances).map(([instanceId, instance]) => [
        instanceId,
        instance.environment?.some((variable) => isRemoved(variable.value))
          ? {
              ...instance,
              environment: instance.environment.filter((variable) => !isRemoved(variable.value)),
            }
          : instance,
      ]),
    ),
  };
}
