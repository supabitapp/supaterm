import { useAtomValue } from "@effect/atom-react";
import {
  AuthAccessWriteScope,
  type EnvironmentId,
  type TailnetSettingsPatch,
} from "@supaterm/contracts";
import { managedSettingDenial } from "@supaterm/client-runtime/managed-policy";
import {
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  TAILNET_MACHINE_NAME_DESCRIPTION,
  TAILSCALE_DNS_ADMIN_URL,
  tailnetAdmissionDescription,
} from "@supaterm/client-runtime/tailnet/view";
import { CheckIcon, CopyIcon, XIcon } from "@supaterm/icons";
import { T, useGT, useMessages } from "gt-react";
import { useState } from "react";

import { isWebUrl } from "~/browser/webUrl";
import { requestConfirmDialog } from "~/confirmDialog";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { ensureLocalApi, readLocalApi } from "~/localApi";
import { useManagedPolicy } from "~/state/managedPolicy";
import { readEnvironmentScope, useEnvironmentScope } from "~/state/session";
import { tailnetEnvironment } from "~/state/tailnet";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  addAllowedTailnetLogin,
  normalizeTailnetHostnameDraft,
  tailnetControlUrlDraftError,
  tailnetHostnameDraftError,
} from "./BuiltInTailscaleSettings.logic";
import { SettingsDisclosure } from "./SettingsDisclosure";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { useTailnetView } from "./useTailnetView";

type SignIn =
  | { readonly phase: "idle" }
  | { readonly phase: "requesting" }
  | { readonly phase: "browser" }
  | { readonly phase: "failed"; readonly message: string };

function failureMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() !== "" ? error.message : fallback;
}

export function BuiltInTailscaleSettings({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const gt = useGT();
  const m = useMessages();
  const searchableSetting = useSearchableSetting();
  const tailnet = useTailnetView(environmentId);
  const policy = useManagedPolicy(environmentId);
  const canWrite = useEnvironmentScope(environmentId, AuthAccessWriteScope);
  const canSignIn = useAtomValue(tailnetEnvironment.login.permissionAtom(environmentId));
  const canSignOut = useAtomValue(tailnetEnvironment.logout.permissionAtom(environmentId));
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const login = useAtomCommand(tailnetEnvironment.login, { reportFailure: false });
  const logout = useAtomCommand(tailnetEnvironment.logout, { reportFailure: false });
  const [signIn, setSignIn] = useState<SignIn>({ phase: "idle" });
  const [signingOut, setSigningOut] = useState(false);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    target: gt("Tailscale address"),
    onError: (error) =>
      toastManager.add({
        type: "error",
        title: gt("Could not copy the Tailscale address"),
        description: error.message,
      }),
  });
  if (tailnet === null) return null;
  const { view, settings, statusError } = tailnet;
  const patch = (tailnetPatch: TailnetSettingsPatch, onFailed?: () => void) =>
    updateSettings({ tailnet: tailnetPatch }, onFailed ? { onFailed } : undefined);
  if (view.kind !== "needs-login" && (signIn.phase === "browser" || signIn.phase === "failed"))
    setSignIn({ phase: "idle" });
  const available = view.kind !== "unavailable";
  const ownerLogin = view.kind === "running" ? view.ownerLogin : null;
  const lock = (path: string) => managedSettingDenial([policy], [path], m);
  const admissionManaged = lock("tailnet.admission");
  const hostnameManaged = lock("tailnet.hostname");
  const allowedLoginsManaged = lock("tailnet.allowedLogins");
  const controlUrlManaged = lock("tailnet.controlUrl");

  const startSignIn = async () => {
    if (signIn.phase === "requesting" || !readEnvironmentScope(environmentId, AuthAccessWriteScope))
      return;
    // Browsers block a tab opened after an await, so reserve it before asking for the link.
    const pending = window.desktopBridge ? null : window.open("", "_blank");
    if (pending) pending.opener = null;
    setSignIn({ phase: "requesting" });
    const result = await login({ environmentId, input: {} });
    if (result._tag === "Failure") {
      pending?.close();
      setSignIn(
        isAtomCommandInterrupted(result)
          ? { phase: "idle" }
          : {
              phase: "failed",
              message: failureMessage(
                squashAtomCommandFailure(result),
                gt("Could not start Tailscale sign-in. Try again."),
              ),
            },
      );
      return;
    }
    const { loginUrl } = result.value;
    if (!isWebUrl(loginUrl)) {
      pending?.close();
      setSignIn({
        phase: "failed",
        message: gt("Tailscale returned a sign-in link that is not a web address."),
      });
      return;
    }
    if (pending) {
      pending.location.href = loginUrl;
      setSignIn({ phase: "browser" });
      return;
    }
    const opened = await settlePromise(() => ensureLocalApi().shell.openExternal(loginUrl));
    setSignIn(
      opened._tag === "Success"
        ? { phase: "browser" }
        : { phase: "failed", message: gt("Could not open the Tailscale sign-in page.") },
    );
  };

  const signOut = async () => {
    if (signingOut) return;
    const confirmed = await requestConfirmDialog(
      gt(
        "Sign out of Tailscale?\nThis machine leaves your tailnet. Devices using its Tailscale address lose access until you sign in again.",
      ),
      { variant: "destructive" },
    );
    if (confirmed !== true || !readEnvironmentScope(environmentId, AuthAccessWriteScope)) return;
    setSigningOut(true);
    const result = await logout({ environmentId, input: {} });
    setSigningOut(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add({
        type: "error",
        title: gt("Could not sign out of Tailscale"),
        description: failureMessage(squashAtomCommandFailure(result), gt("Try again.")),
      });
    }
  };

  const accountAction =
    view.account?.action === "sign-in" && canSignIn ? (
      <Button size="sm" disabled={signIn.phase === "requesting"} onClick={() => void startSignIn()}>
        {signIn.phase === "requesting" ? gt("Opening Tailscale…") : gt("Sign in…")}
      </Button>
    ) : view.account?.action === "sign-out" && canSignOut ? (
      <Button size="sm" variant="outline" disabled={signingOut} onClick={() => void signOut()}>
        <T>Sign out…</T>
      </Button>
    ) : undefined;

  return (
    <SettingsSection {...searchableSetting("built-in-tailscale")}>
      <SettingsRow
        title={gt("Serve over Tailscale")}
        description={view.summary}
        managed={view.serveManaged}
        status={
          statusError !== null ? (
            <span className="block text-destructive">{statusError}</span>
          ) : null
        }
        control={
          <Switch
            checked={settings.enabled}
            disabled={!canWrite || (!available && !settings.enabled)}
            onCheckedChange={(enabled) => patch({ enabled })}
            aria-label={gt("Serve over built-in Tailscale")}
          />
        }
      />
      {view.account !== null ? (
        <SettingsRow
          title={view.account.title}
          description={view.account.detail ?? undefined}
          status={
            view.account.warnings.length > 0 || signIn.phase !== "idle" ? (
              <>
                {view.account.warnings.map((warning) => (
                  <span key={warning} className="block text-warning-foreground">
                    {warning}
                  </span>
                ))}
                {signIn.phase === "browser" ? (
                  <span className="block">
                    <T>Finish signing in in your browser. This page updates on its own.</T>{" "}
                    <InlineButton tone="link" onClick={() => void startSignIn()}>
                      <T>Open it again</T>
                    </InlineButton>
                  </span>
                ) : signIn.phase === "failed" ? (
                  <span className="block text-destructive">{signIn.message}</span>
                ) : null}
              </>
            ) : null
          }
          control={accountAction}
        />
      ) : null}
      {view.kind === "running" ? (
        <SettingsRow
          title={gt("Address", { $context: "network address of this machine" })}
          description={
            <>
              <span className="block select-text">{view.address ?? view.dnsName}</span>
              {view.addressNote !== null ? (
                <span className="block">
                  {view.addressNote}
                  {view.https === "unavailable" ? (
                    <>
                      {" "}
                      <InlineButton
                        tone="link"
                        onClick={() =>
                          void readLocalApi()?.shell.openExternal(TAILSCALE_DNS_ADMIN_URL)
                        }
                      >
                        <T>Turn them on in Tailscale</T>
                      </InlineButton>
                    </>
                  ) : null}
                </span>
              ) : null}
            </>
          }
          control={
            view.address !== null ? (
              <Button
                size="icon-sm"
                variant="outline"
                aria-label={isCopied ? gt("Copied") : gt("Copy Tailscale address")}
                onClick={() => copyToClipboard(view.address ?? "", undefined)}
              >
                {isCopied ? <CheckIcon /> : <CopyIcon />}
              </Button>
            ) : undefined
          }
        />
      ) : null}
      {available ? (
        <>
          <SettingsRow
            title={gt("Limit access to your Tailscale account")}
            description={tailnetAdmissionDescription(settings.admission, ownerLogin, m)}
            managed={admissionManaged}
            control={
              <Switch
                checked={settings.admission === "owner"}
                disabled={!canWrite}
                onCheckedChange={(owner) => patch({ admission: owner ? "owner" : "tailnet" })}
                aria-label={gt("Limit access to your Tailscale account")}
              />
            }
          />
          <HostnameRow
            value={view.hostname}
            running={settings.enabled}
            disabled={!canWrite}
            managed={hostnameManaged}
            onCommit={(hostname, restore) => patch({ hostname }, restore)}
          />
          <SettingsDisclosure title={<T>Advanced</T>}>
            {settings.admission === "owner" ? (
              <AllowedLoginsRow
                allowed={settings.allowedLogins}
                disabled={!canWrite}
                managed={allowedLoginsManaged}
                onChange={(allowedLogins) => patch({ allowedLogins })}
              />
            ) : null}
            <DraftRow
              title={gt("Control server")}
              description={gt("Leave empty for Tailscale. Enter a Headscale URL to use your own.")}
              ariaLabel={gt("Tailscale control server URL")}
              placeholder="Tailscale"
              value={settings.controlUrl}
              validate={(draft) => tailnetControlUrlDraftError(draft, m)}
              actionLabel={gt("Save")}
              disabled={!canWrite}
              managed={controlUrlManaged}
              onCommit={async (controlUrl, restore) => {
                if (settings.enabled) {
                  const confirmed = await requestConfirmDialog(
                    controlUrl === ""
                      ? gt(
                          "Use Tailscale's control server?\nBuilt-in Tailscale restarts, and you may need to sign in again.",
                        )
                      : gt(
                          "Use {controlUrl} as the control server?\nBuilt-in Tailscale restarts, and you may need to sign in again.",
                          { controlUrl },
                        ),
                  );
                  if (confirmed !== true) return false;
                }
                patch({ controlUrl }, restore);
                return true;
              }}
            />
          </SettingsDisclosure>
        </>
      ) : null}
    </SettingsSection>
  );
}

function HostnameRow({
  value,
  running,
  disabled,
  managed,
  onCommit,
}: {
  readonly value: string;
  readonly running: boolean;
  readonly disabled: boolean;
  readonly managed: string | undefined;
  readonly onCommit: (hostname: string, restore: () => void) => void;
}) {
  const gt = useGT();
  const m = useMessages();
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const error = draft === null ? null : tailnetHostnameDraftError(draft, m);
  const commit = async () => {
    const next = shown.trim();
    if (disabled || draft === null || next === value || error !== null) {
      if (draft !== null && next === value) setDraft(null);
      return;
    }
    if (running) {
      const confirmed = await requestConfirmDialog(
        gt(
          "Rename this machine to {next}?\nBuilt-in Tailscale restarts with a new address. Saved routes that use {value} stop working.",
          { next, value },
        ),
      );
      if (confirmed !== true) return;
    }
    onCommit(next, () => setDraft(next));
    setDraft(null);
  };
  return (
    <SettingsRow
      title={gt("Machine name")}
      description={m(TAILNET_MACHINE_NAME_DESCRIPTION)}
      status={error ? <span className="block text-destructive">{error}</span> : null}
      managed={managed}
      control={
        <Input
          size="sm"
          aria-label={gt("Tailscale machine name")}
          autoCapitalize="none"
          spellCheck={false}
          disabled={disabled}
          value={shown}
          onChange={(event) => setDraft(normalizeTailnetHostnameDraft(event.target.value))}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setDraft(null);
          }}
        />
      }
    />
  );
}

function AllowedLoginsRow({
  allowed,
  disabled,
  managed,
  onChange,
}: {
  readonly allowed: ReadonlyArray<string>;
  readonly disabled: boolean;
  readonly managed: string | undefined;
  readonly onChange: (allowed: ReadonlyArray<string>) => void;
}) {
  const gt = useGT();
  const [draft, setDraft] = useState("");
  const next = addAllowedTailnetLogin(allowed, draft);
  const locked = disabled || managed !== undefined;
  const add = () => {
    if (next === null || locked) return;
    onChange(next);
    setDraft("");
  };
  return (
    <SettingsRow
      title={gt("Also allow")}
      description={gt("Other Tailscale accounts that can connect.")}
      managed={managed}
      control={
        <>
          <Input
            size="sm"
            aria-label={gt("Tailscale login to allow")}
            placeholder="name@example.com"
            autoCapitalize="none"
            spellCheck={false}
            disabled={disabled}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") add();
            }}
          />
          <Button size="sm" variant="outline" disabled={disabled || next === null} onClick={add}>
            <T>Add</T>
          </Button>
        </>
      }
    >
      {allowed.length > 0 ? (
        <ul className="flex flex-wrap gap-1 pb-1.5">
          {allowed.map((login) => (
            <li key={login}>
              <Badge size="control" variant="outline">
                {login}
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label={gt("Remove {login}", { login })}
                  disabled={locked}
                  onClick={() => onChange(allowed.filter((existing) => existing !== login))}
                >
                  <XIcon />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
    </SettingsRow>
  );
}

function DraftRow({
  title,
  description,
  ariaLabel,
  placeholder,
  value,
  normalize,
  validate,
  actionLabel,
  disabled,
  managed,
  onCommit,
}: {
  readonly title: string;
  readonly description: string;
  readonly ariaLabel: string;
  readonly placeholder?: string;
  readonly value: string;
  readonly normalize?: (draft: string) => string;
  readonly validate: (draft: string) => string | null;
  readonly actionLabel: string;
  readonly disabled: boolean;
  readonly managed: string | undefined;
  readonly onCommit: (value: string, restore: () => void) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  const error = draft === null ? null : validate(draft);
  const changed = draft !== null && draft.trim() !== value;
  const commit = async () => {
    if (disabled || !changed || error !== null) return;
    const committed = shown.trim();
    if (await onCommit(committed, () => setDraft(committed))) setDraft(null);
  };
  return (
    <SettingsRow
      title={title}
      description={description}
      status={error ? <span className="block text-destructive">{error}</span> : null}
      managed={managed}
      control={
        <>
          <Input
            size="sm"
            aria-label={ariaLabel}
            placeholder={placeholder}
            autoCapitalize="none"
            spellCheck={false}
            disabled={disabled}
            value={shown}
            onChange={(event) =>
              setDraft(normalize ? normalize(event.target.value) : event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key === "Enter") void commit();
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || !changed || error !== null}
            onClick={() => void commit()}
          >
            {actionLabel}
          </Button>
        </>
      }
    />
  );
}
