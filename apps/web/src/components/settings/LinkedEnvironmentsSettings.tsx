import { useAtomValue } from "@effect/atom-react";
import {
  ANOTHER_ADDRESS,
  linkLabels,
  linkRequestFailureMessage,
  machineLinkInput,
} from "@supaterm/client-runtime/link-request";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  type AuthMcpClientAccess,
  type EnvironmentId,
  type PeerLinkCreateInput,
  type PeerLinkSummary,
} from "@supaterm/contracts";
import { ArrowRightIcon, PlusIcon } from "@supaterm/icons";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@supaterm/client-runtime/state/runtime";
import {
  DIRECT_LINK_PAIRING,
  incomingLinkNames,
  peerLinkHealth,
  peerLinkHealthText,
} from "@supaterm/client-runtime/state/peerLinks";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import { useId, useRef, useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import {
  type KnownMachineLinkResult,
  linkKnownMachine,
  peerLinkEnvironment,
  useLinkableMachines,
  usePeerLinkHosts,
} from "~/state/peerLinks";
import { useEnvironmentIdentities } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import {
  useEnvironmentScope,
  useEnvironmentsWithScope,
  usePreparedConnection,
} from "~/state/session";
import { useAtomCommand } from "~/state/use-atom-command";
import { accessConfig } from "../auth/ConnectAgentSurface";
import { ConnectionStatusDot } from "../ConnectionStatusDot";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { ITEM_ROW_CLASSNAME, ITEM_ROW_INNER_CLASSNAME } from "./itemRows";
import { LinkAccessPicker } from "./LinkAccessPicker";
import { LinkAddressWarning, LinkMachineSelect } from "./LinkMachineSelect";
import { SettingsRow, SettingsSection } from "./settingsLayout";
import { useLiveRefresh } from "../../hooks/useLiveRefresh";
import { useNowMinute } from "../../hooks/useNowMinute";
import { useSearchableSetting } from "./settingsSearch";
import { T, useGT, Var, useMessages } from "gt-react";

// Console log labels for the atom commands.
export const UNLINK_COMMAND_LABEL = "unlink environment";
const LINK_COMMAND_LABEL = "link environment";

export const failureToast = (title: string, failure: unknown) =>
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: failure instanceof Error ? failure.message : String(failure),
    }),
  );

export function LinkedEnvironmentsSections() {
  const searchableSetting = useSearchableSetting();
  const hosts = usePeerLinkHosts();
  const search = searchableSetting("linked-environments");
  const incoming = useIncomingLinkNames(hosts);
  if (hosts.length === 0) return null;
  return (
    <SettingsSection id={search.id} title={search.title}>
      {hosts.map((environment) => (
        <LinkedEnvironmentHost
          key={environment.environmentId}
          environmentId={environment.environmentId}
          environmentLabel={hosts.length > 1 ? environment.label : null}
          incoming={incoming.get(environment.environmentId) ?? []}
        />
      ))}
    </SettingsSection>
  );
}

/** Reads each readable source's links once, for every host row to share. */
function useIncomingLinkNames(
  sources: ReadonlyArray<{ readonly environmentId: EnvironmentId; readonly label: string }>,
) {
  const readable = useEnvironmentsWithScope(sources, AuthAccessReadScope);
  const permitted = sources.filter((source) => readable.has(source.environmentId));
  const results = useAtomValue(
    peerLinkEnvironment.lists(permitted.map((source) => source.environmentId)),
  );
  const nowMinute = useNowMinute();
  return incomingLinkNames({
    sources: permitted.flatMap((source, index) => {
      const result = results[index];
      return result !== undefined && AsyncResult.isSuccess(result)
        ? [{ label: source.label, links: result.value.links }]
        : [];
    }),
    now: DateTime.makeUnsafe(nowMinute),
  });
}

function LinkedEnvironmentHost({
  environmentId,
  environmentLabel,
  incoming,
}: {
  readonly environmentId: EnvironmentId;
  readonly environmentLabel: string | null;
  /** The other connected machines whose links reach this one. */
  readonly incoming: ReadonlyArray<string>;
}) {
  const gt = useGT();
  const canLink = useAtomValue(peerLinkEnvironment.link.permissionAtom(environmentId));
  const canList = useEnvironmentScope(environmentId, AuthAccessReadScope);
  return (
    <>
      <SettingsRow
        title={environmentLabel ?? gt("Let agents here work on your other machines")}
        description={
          <>
            <T>Agents here can work on machines you link. Each link goes one way.</T>
            {incoming.length > 0 ? (
              <span className="block">
                <T>
                  Linked from <Var>{incoming.join(", ")}</Var>.
                </T>
              </span>
            ) : null}
          </>
        }
        control={
          canLink ? (
            <LinkEnvironmentAction
              environmentId={environmentId}
              environmentLabel={environmentLabel}
            />
          ) : null
        }
      />
      {canList ? <LinkedEnvironmentsList environmentId={environmentId} /> : null}
    </>
  );
}

export function LinkedEnvironmentsList({
  environmentId,
}: {
  readonly environmentId: EnvironmentId;
}) {
  const gt = useGT();
  const links = useEnvironmentQuery(peerLinkEnvironment.list({ environmentId, input: {} }));
  const identities = useEnvironmentIdentities();
  // Links made outside this client bump nothing the shared list reads, so showing the panel
  // asks again. Listing probes every linked environment, too costly for a timer nobody asked for.
  // A list still loading counts as read now, so the next return to the window asks again.
  useLiveRefresh(
    () => {
      if (!links.isPending) links.refresh();
    },
    {
      key: `linked-environments:${environmentId}`,
      intervalMs: null,
      refreshOnShow: true,
    },
  );
  if (links.error) {
    return (
      <SettingsRow title={gt("Could not load linked environments")} description={links.error} />
    );
  }
  if (!links.data) return <SettingsRow title={gt("Loading linked environments…")} role="status" />;
  if (links.data.links.length === 0) return null;
  const labels = linkLabels({ links: links.data.links, environments: identities });
  return links.data.links.map((link) => (
    <LinkedEnvironmentRow
      key={link.environmentId}
      environmentId={environmentId}
      link={link}
      label={labels.get(link.environmentId) ?? link.label}
    />
  ));
}

function LinkedEnvironmentRow({
  environmentId,
  link,
  label,
}: {
  readonly environmentId: EnvironmentId;
  readonly link: PeerLinkSummary;
  /** What this client calls the linked environment. */
  readonly label: string;
}) {
  const messages = useMessages();
  const gt = useGT();
  const nowMinute = useNowMinute();
  const health = peerLinkHealth(link, DateTime.makeUnsafe(nowMinute));
  const unlink = useAtomCommand(peerLinkEnvironment.unlink, { label: UNLINK_COMMAND_LABEL });
  const canUnlink = useAtomValue(peerLinkEnvironment.unlink.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false);
  const forget = async () => {
    const confirmed = await (requestConfirmDialog(
      `Forget ${label}? Agents here stop working there, and their session on ${label} ends too if it answers.`,
      { variant: "destructive" },
    ) ?? Promise.resolve(false));
    if (!confirmed) return;
    setBusy(true);
    const result = await unlink({ environmentId, input: { environmentId: link.environmentId } });
    setBusy(false);
    if (result._tag === "Success") {
      if (result.value.removed && result.value.endedThere !== true) {
        toastManager.add({
          type: "warning",
          title: gt("{label} did not answer", { label }),
          description: gt(
            "Revoke \"Supaterm · …\" in {label}''s Sharing & access to end the session there too.",
            { label },
          ),
        });
      }
    } else if (!isAtomCommandInterrupted(result)) {
      failureToast("Could not forget the link", squashAtomCommandFailure(result));
    }
  };
  const status = peerLinkHealthText(health, messages);
  return (
    <div className={cn(ITEM_ROW_CLASSNAME, "pl-8 sm:pl-10")}>
      <div className={ITEM_ROW_INNER_CLASSNAME}>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex min-h-5 items-center gap-1.5">
            <ConnectionStatusDot
              tooltipText={status}
              dotClassName={
                health.kind === "reachable"
                  ? health.expiresInDays === null
                    ? "bg-success"
                    : "bg-warning"
                  : health.kind === "expired" || health.kind === "failing"
                    ? "bg-destructive"
                    : "bg-muted-foreground/30"
              }
              pingClassName={null}
            />
            <ArrowRightIcon aria-hidden className="size-3.5 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">{label}</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            {messages(accessConfig[link.access].label)} · {status}
          </p>
          {health.kind === "reachable" && health.expiresInDays === null ? null : (
            <p className="truncate text-xs text-muted-foreground/80">{link.urls.join(", ")}</p>
          )}
        </div>
        {canUnlink ? (
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto sm:justify-end">
            <Button
              size="xs"
              variant="destructive-outline"
              disabled={busy}
              onClick={() => void forget()}
            >
              {busy ? gt("Forgetting…") : gt("Forget")}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LinkEnvironmentAction({
  environmentId,
  environmentLabel,
}: {
  readonly environmentId: EnvironmentId;
  /** The machine the link starts from, when the section lists more than one. */
  readonly environmentLabel: string | null;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const machines = useLinkableMachines(environmentId, open);
  // Null until the user picks; with no other machines known, only an address is left.
  const [choice, setChoice] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [access, setAccess] = useState<AuthMcpClientAccess>("approval-required");
  const [busy, setBusy] = useState(false);
  // Machines whose minting already failed, so the dialog asks for a code instead.
  const [mintFailed, setMintFailed] = useState<ReadonlySet<EnvironmentId>>(new Set());
  // Enter then a click can both run before a re-render; this guard is synchronous.
  const inFlight = useRef(false);
  const formId = useId();
  const link = useAtomCommand(peerLinkEnvironment.link, { label: LINK_COMMAND_LABEL });
  const selected = choice ?? (machines.length === 0 ? ANOTHER_ADDRESS : null);
  const machine = machines.find((candidate) => candidate.environmentId === selected) ?? null;
  const targetId = machine?.environmentId ?? null;
  const connected = usePreparedConnection(targetId);
  const mayMint = useEnvironmentScope(targetId, AuthAccessWriteScope);
  // A picked machine that left the list has no address here either.
  const needsAddress = selected !== null && (machine === null || machine.urls.length === 0);
  // This client mints a code there when it is connected with a session that may
  // create pairing links, and only for its own addresses: anything can answer
  // as that machine at one typed in, so that one gets a code the user fetched.
  const canMint =
    targetId !== null &&
    !needsAddress &&
    Option.isSome(connected) &&
    mayMint &&
    !mintFailed.has(targetId);
  const ready =
    selected !== null &&
    (!needsAddress || address.trim().length > 0) &&
    (canMint || pairingCode.trim().length > 0);
  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setChoice(null);
      setAddress("");
      setPairingCode("");
      setAccess("approval-required");
      setMintFailed(new Set());
    }
  };
  // Settles to the code to link with, or null after reporting why there is none.
  const finish = (result: KnownMachineLinkResult) => {
    if (result._tag === "Linked") {
      toastManager.add({ type: "success", title: gt("Linked {label}", { label: result.label }) });
      handleOpenChange(false);
    } else if (result._tag === "MintFailed" && targetId !== null) {
      setMintFailed((failed) => new Set(failed).add(targetId));
      failureToast("Could not link the environment", linkRequestFailureMessage(result.failure));
    } else if (result._tag !== "Interrupted") {
      failureToast("Could not link the environment", result.failure);
    }
  };
  const linkWithPastedCode = async (
    input: PeerLinkCreateInput | null,
  ): Promise<KnownMachineLinkResult> => {
    if (input === null) {
      return { _tag: "LinkFailed", failure: new Error("No address for that machine.") };
    }
    const result = await link({ environmentId, input });
    if (result._tag === "Success") return { _tag: "Linked", label: result.value.label };
    return isAtomCommandInterrupted(result)
      ? { _tag: "Interrupted" }
      : { _tag: "LinkFailed", failure: squashAtomCommandFailure(result) };
  };
  const submit = async () => {
    const typed = machine === null || needsAddress;
    if (inFlight.current || !ready) return;
    inFlight.current = true;
    setBusy(true);
    const code = pairingCode.trim();
    // A typed address links alone: only this app's own addresses name a machine.
    const result: KnownMachineLinkResult =
      !typed && canMint
        ? await linkKnownMachine({
            sourceId: environmentId,
            machine,
            access,
            route: DIRECT_LINK_PAIRING,
          })
        : await linkWithPastedCode(
            typed
              ? { url: address.trim(), pairingCode: code, access }
              : machineLinkInput(machine, code, access),
          );
    inFlight.current = false;
    setBusy(false);
    finish(result);
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        handleOpenChange(next);
      }}
    >
      <DialogTrigger
        render={
          <Button
            size="xs"
            variant="default"
            {...(environmentLabel === null
              ? {}
              : {
                  "aria-label": gt("Link {label} to another machine", { label: environmentLabel }),
                })}
          >
            <PlusIcon className="size-3" />
            {gt("Link", { $context: "verb, links an environment" })}
          </Button>
        }
      />
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {environmentLabel === null ? (
              <T>Link an environment</T>
            ) : (
              gt("Link {label} to an environment", { label: environmentLabel })
            )}
          </DialogTitle>
          <DialogDescription>
            <T>
              Agents here can then launch, message and wait on threads there. It appears under
              Authorized clients in that environment's Sharing & access, where it can be revoked.
            </T>
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            id={formId}
            className="space-y-4"
            autoComplete="off"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {machines.length > 0 ? (
              <LinkMachineSelect
                machines={machines}
                value={selected}
                disabled={busy}
                onChange={setChoice}
              />
            ) : null}
            {machine?.linked ? (
              <p className="text-xs text-muted-foreground">
                <T>Already linked. Linking again renews it with the access you pick.</T>
              </p>
            ) : null}
            {needsAddress ? (
              <label className="block space-y-1.5">
                <span className="block text-xs font-medium text-foreground">
                  <T>Address</T>
                </span>
                <Input
                  value={address}
                  onChange={(event) => {
                    setAddress(event.target.value);
                    // Machines found after typing began must not hide the address being typed.
                    if (choice === null) setChoice(ANOTHER_ADDRESS);
                  }}
                  placeholder="https://box.example.ts.net"
                  disabled={busy}
                  autoFocus={machines.length === 0}
                  nativeInput
                  spellCheck={false}
                />
                {machine !== null ? (
                  <span className="block text-xs text-muted-foreground">
                    <T>
                      This app has no address for <Var>{machine.label}</Var> that another machine
                      can reach. Enter its https or Tailscale address.
                    </T>
                  </span>
                ) : null}
              </label>
            ) : null}
            {needsAddress && address.trim() ? <LinkAddressWarning address={address} /> : null}
            {selected === null || canMint ? null : (
              <label className="block space-y-1.5">
                <span className="block text-xs font-medium text-foreground">
                  <T>Pairing code</T>
                </span>
                <Input
                  value={pairingCode}
                  onChange={(event) => setPairingCode(event.target.value)}
                  placeholder={
                    machine === null
                      ? gt("From Sharing & access there, or supaterm pair")
                      : gt("Paste the code")
                  }
                  disabled={busy}
                  autoComplete="one-time-code"
                  nativeInput
                  spellCheck={false}
                />
                {machine !== null ? (
                  <span className="block text-xs text-muted-foreground">
                    <T>
                      Create a link on <Var>{machine.label}</Var>: Settings → Sharing & access →
                      Authorized clients → Create link, then paste its code here.
                    </T>
                  </span>
                ) : null}
              </label>
            )}
            <LinkAccessPicker value={access} onChange={setAccess} disabled={busy} />
          </form>
        </DialogPanel>
        <DialogFooter variant="bare">
          <DialogClose disabled={busy} render={<Button variant="outline" type="button" />}>
            <T>Cancel</T>
          </DialogClose>
          <Button form={formId} type="submit" disabled={busy || !ready}>
            {busy ? gt("Linking…") : gt("Link", { $context: "verb, links an environment" })}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
