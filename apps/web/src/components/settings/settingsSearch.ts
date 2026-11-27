import { HOSTED_APP_CHANNEL } from "~/branding";
import { isElectron } from "~/env";
import { isMacPlatform, isWindowsPlatform, normalizeSearchText } from "~/lib/utils";
import { STATIC_KEYBINDING_COMMANDS, type KeybindingCommand } from "@supaterm/contracts";
import type { EnvironmentId } from "@supaterm/contracts";
import type { EnvironmentConnectionPhase } from "@supaterm/client-runtime/connection";
import {
  sourceControlClients,
  type SourceControlDefinition,
} from "@supaterm/client-runtime/source-control-clients";
import { DEFAULT_KEYBINDINGS } from "@supaterm/shared/keybindings";
import { BUILT_IN_THEMES } from "@supaterm/shared/themePalettes";
import { getCodexMicroBridge } from "../codexMicro/codexMicroBridge";
import { CODEX_MICRO_SETTINGS_SEARCH_ITEMS } from "../codexMicro/codexMicroSettingsSearch";
import { getSidePulseBridge } from "../sidePulse/sidePulseBridge";
import { SIDE_PULSE_SETTINGS_SEARCH_ITEMS } from "../sidePulse/sidePulseSettingsSearch";
import * as Schema from "effect/Schema";
import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { writeLocalStorageValue } from "../../hooks/useLocalStorage";
import { commandLabel } from "./KeybindingsSettings.logic";
import type { ResolvedSettingsScope } from "./settingsScope";
import { decodeMsg, msg, useMessages } from "gt-react";
import type { MessageResolver } from "~/i18n/messages";

export type SettingsPath =
  | "/settings/projects"
  | "/settings/general"
  | "/settings/diagnostics"
  | "/settings/appearance"
  | "/settings/chat"
  | "/settings/diffs"
  | "/settings/keybindings"
  | "/settings/snap-shot"
  | "/settings/codex-micro"
  | "/settings/sidepulse"
  | "/settings/providers"
  | "/settings/threads"
  | "/settings/skills"
  | "/settings/voice"
  | "/settings/browser"
  | "/settings/devices"
  | "/settings/source-control"
  | "/settings/worktrees"
  | "/settings/connections"
  | "/settings/access"
  | "/settings/secrets"
  | "/settings/maintenance"
  | "/settings/about"
  | "/settings/archived";

export type SettingsSearchScope =
  | "environment"
  | "environment-defaults"
  | "project-defaults"
  | "project"
  | "checkout"
  | "connections";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  readonly searchTerms?: ReadonlyArray<string>;
  readonly scope?: SettingsSearchScope;
  readonly desktopOnly?: boolean;
  readonly macOnly?: boolean;
  readonly windowsOnly?: boolean;
  readonly releaseChannelOnly?: boolean;
  readonly environmentOnly?: boolean;
  readonly providerSettingsOnly?: boolean;
  readonly localBackendManagementOnly?: boolean;
  readonly primaryEnvironmentOnly?: boolean;
  readonly wslAvailableOnly?: boolean;
  readonly fastWorktreeCheckoutOnly?: boolean;
  readonly peerLinksOnly?: boolean;
  readonly secretProvidersOnly?: boolean;
  readonly secondary?: boolean;
  readonly requiresThreadAutoMarkDone?: boolean;
}

export interface SettingsSearchAvailability {
  readonly hasEnvironment: boolean;
  readonly hasProviderSettingsEnvironment: boolean;
  readonly canManageLocalBackend: boolean;
  readonly isWslSettingsRowVisible: boolean;
  readonly hasThreadAutoMarkDone: boolean;
  readonly hasFastWorktreeCheckoutEnvironment?: boolean;
  readonly hasPeerLinkHost?: boolean;
  readonly hasPrimaryEnvironment?: boolean;
  readonly hasSecretProvidersEnvironment?: boolean;
}

export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/diagnostics": msg("Diagnostics"),
  "/settings/projects": msg("Projects"),
  "/settings/general": msg("General"),
  "/settings/appearance": msg("Appearance"),
  "/settings/chat": msg("Chat"),
  "/settings/diffs": msg("Diffs & pull requests"),
  "/settings/keybindings": msg("Keybindings"),
  "/settings/snap-shot": msg("SnapShots"),
  "/settings/codex-micro": "Codex Micro",
  "/settings/sidepulse": "SidePulse",
  "/settings/providers": msg("Providers"),
  "/settings/threads": msg("Threads"),
  "/settings/skills": msg("Skills"),
  "/settings/voice": msg("Voice transcription"),
  "/settings/browser": msg("Browser"),
  "/settings/devices": msg("Devices"),
  "/settings/source-control": msg("Source control & issues"),
  "/settings/worktrees": msg("Worktrees"),
  "/settings/connections": msg("Environments"),
  "/settings/access": msg("Sharing & access"),
  "/settings/secrets": msg("Secrets"),
  "/settings/maintenance": msg("Maintenance"),
  "/settings/about": msg("About"),
  "/settings/archived": msg("Archive"),
};

/** Sidebar order. A group with a hidden heading is set apart on screen by space alone. */
export const SETTINGS_NAV_GROUPS: ReadonlyArray<{
  readonly heading: string;
  readonly headingHidden?: true;
  readonly paths: ReadonlyArray<SettingsPath>;
}> = [
  {
    heading: msg("Preferences"),
    headingHidden: true,
    paths: [
      "/settings/general",
      "/settings/appearance",
      "/settings/chat",
      "/settings/diffs",
      "/settings/keybindings",
      "/settings/snap-shot",
      "/settings/codex-micro",
      "/settings/sidepulse",
    ],
  },
  {
    heading: msg("Agents"),
    paths: [
      "/settings/providers",
      "/settings/threads",
      "/settings/skills",
      "/settings/voice",
      "/settings/browser",
      "/settings/devices",
    ],
  },
  {
    heading: msg("Code"),
    paths: ["/settings/projects", "/settings/source-control", "/settings/worktrees"],
  },
  {
    heading: msg("Connections"),
    paths: ["/settings/connections", "/settings/access", "/settings/secrets"],
  },
  {
    heading: msg("More"),
    headingHidden: true,
    paths: ["/settings/maintenance", "/settings/about", "/settings/archived"],
  },
];

const SETTINGS_SECTION_AVAILABILITY: Partial<Record<SettingsPath, () => boolean>> = {
  "/settings/codex-micro": () => getCodexMicroBridge() !== null,
  "/settings/sidepulse": () => getSidePulseBridge() !== null,
};

/** An unavailable section is hidden from navigation and search, and its route redirects. */
export function isSettingsSectionAvailable(path: SettingsPath): boolean {
  return SETTINGS_SECTION_AVAILABILITY[path]?.() ?? true;
}

export function keybindingSearchAnchorId<Command extends KeybindingCommand>(command: Command) {
  return `keybinding-${command}` as const;
}

const untranslated = ((message) => message) as MessageResolver;

const KEYBINDING_SEARCH_ITEMS = STATIC_KEYBINDING_COMMANDS.toSorted((left, right) =>
  commandLabel(left).localeCompare(commandLabel(right)),
).map((command) => {
  const defaultKeys = DEFAULT_KEYBINDINGS.filter((binding) => binding.command === command).map(
    (binding) => binding.key,
  );
  return {
    id: keybindingSearchAnchorId(command),
    title: commandLabel(command, untranslated),
    to: "/settings/keybindings" as const,
    searchTerms: [command, ...defaultKeys],
    secondary: true,
    ...(defaultKeys.length === 0 ? { targetId: "keybindings" } : {}),
  };
});

export function sourceControlHostSettingsSearchId(kind: string) {
  return `source-control-host-${kind}` as const;
}

/** Each host's own settings: its accounts and token, or the fields of its settings form. */
export function sourceControlHostSearchItems(
  definitions: ReadonlyArray<SourceControlDefinition>,
): ReadonlyArray<
  SettingsSearchItem & { readonly id: ReturnType<typeof sourceControlHostSettingsSearchId> }
> {
  return definitions.flatMap((definition) => {
    if (!definition.settings) return [];
    const names = [definition.label, ...(definition.searchKeywords ?? [])].join(" ");
    const { credentials } = definition;
    return [
      {
        id: sourceControlHostSettingsSearchId(definition.kind),
        title: credentials
          ? msg("{label} accounts and token", { label: definition.label })
          : msg("{label} credentials", { label: definition.label }),
        to: "/settings/source-control" as const,
        searchTerms: [
          credentials
            ? msg(
                "{names} {cli} account login user host switch multiple accounts disable sign in token personal access token pat api key credential",
                { names, cli: credentials.cliName },
              )
            : msg("{names} {fields} token credentials sign in", {
                names,
                fields: Object.keys(definition.settings.fields).join(" "),
              }),
        ],
        environmentOnly: true,
        scope: "environment-defaults" as const,
      },
    ];
  });
}

/** For settings that apply to every host. */
const SOURCE_CONTROL_HOST_LABELS = sourceControlClients.definitions
  .map((definition) => definition.label)
  .join(" ");
const SOURCE_CONTROL_HOST_TERMS = sourceControlClients.definitions
  .flatMap((definition) => [definition.label, ...(definition.searchKeywords ?? [])])
  .join(" ");

export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "app-version",
    title: msg("Version"),
    to: "/settings/about",
    searchTerms: [msg("about check for updates download install upgrade release")],
  },
  {
    id: "update-track",
    title: msg("Update track"),
    to: "/settings/about",
    searchTerms: [msg("release channel stable latest nightly prerelease")],
    releaseChannelOnly: true,
  },
  {
    id: "telemetry-export",
    title: msg("OpenTelemetry export"),
    to: "/settings/diagnostics",
    targetId: "telemetry-export",
    scope: "environment",
    searchTerms: [msg("OTel OTLP telemetry export endpoints logs traces metrics Grafana")],
  },
  {
    id: "storage-worktree-keep-when",
    targetId: "storage-worktrees",
    title: msg("Keep worktrees with local changes"),
    to: "/settings/worktrees",
    scope: "project-defaults",
    searchTerms: [
      msg(
        "any local files uncommitted changes edited tracked files ignored env build output cleanup",
      ),
    ],
  },
  {
    id: "storage-delete-now",
    title: msg("Delete now"),
    to: "/settings/maintenance",
    scope: "environment-defaults",
    searchTerms: [msg("storage cleanup run now results report removed kept failed")],
  },
  {
    id: "storage-worktrees",
    title: msg("Worktree cleanup"),
    to: "/settings/worktrees",
    scope: "project-defaults",
    searchTerms: [
      msg(
        "disk storage automatic delete deleted archived threads old inactive merged done unchanged worktrees retention days project inherit off custom",
      ),
    ],
  },
  {
    id: "storage-worktrees-location",
    title: msg("Worktree location"),
    to: "/settings/worktrees",
    scope: "environment-defaults",
    searchTerms: [msg("worktree location folder directory path drive external disk")],
  },
  {
    id: "worktree-fast-checkout",
    title: msg("Fast worktree checkout"),
    to: "/settings/worktrees",
    scope: "environment-defaults",
    fastWorktreeCheckoutOnly: true,
    searchTerms: [msg("fast worktree checkout clone apfs copy-on-write cache macos speed")],
  },
  {
    id: "storage-artifacts",
    title: msg("Artifacts and logs"),
    to: "/settings/maintenance",
    scope: "environment-defaults",
    searchTerms: [
      msg(
        "disk storage delete old browser artifacts screenshots captures rotated logs cleanup retention",
      ),
    ],
  },
  {
    id: "project-defaults",
    title: msg("Project defaults and overrides"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [msg("model workspace environments projects inheritance checkout")],
  },
  {
    id: "default-model",
    title: msg("Default model"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [msg("new thread project provider reasoning effort")],
  },
  {
    id: "fallback-model",
    title: msg("Fallback model"),
    to: "/settings/threads",
    searchTerms: [msg("new thread out of usage limit quota provider switch backup")],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "default-permissions",
    title: msg("Permissions"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [
      msg("new thread default runtime mode supervised approvals auto accept edits full access"),
    ],
  },
  {
    id: "new-threads",
    title: msg("New threads"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [msg("default workspace mode draft local worktree")],
  },
  {
    id: "worktree-submodules",
    title: msg("Submodules"),
    to: "/settings/worktrees",
    scope: "project-defaults",
    searchTerms: [msg("git submodule init recursive top-level none worktree supaterm.json")],
  },
  {
    id: "start-from-origin",
    title: msg("Start from remote"),
    to: "/settings/worktrees",
    scope: "project-defaults",
    searchTerms: [msg("new worktrees latest matching remote branch local")],
  },
  {
    id: "thread-notifications",
    title: msg("Thread notifications"),
    to: "/settings/general",
    searchTerms: [msg("notification sound alert completion input approval desktop")],
  },
  {
    id: "in-app-notifications",
    title: msg("In-app notifications"),
    to: "/settings/general",
    searchTerms: [msg("notification toast popup completion input approval failure")],
  },
  {
    id: "response-streaming",
    title: msg("Response streaming"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [msg("output token paragraph buffered wait turn legacy")],
  },
  {
    id: "auto-resume-limited-threads",
    title: msg("Resume after usage limits"),
    to: "/settings/threads",
    searchTerms: [msg("usage quota rate limit reset recover continue")],
  },
  {
    id: "snooze-options",
    title: msg("Snooze options"),
    to: "/settings/threads",
    searchTerms: [msg("snooze presets times later tonight tomorrow next week remind")],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "snooze-limited-threads",
    title: msg("Snooze until limits reset"),
    to: "/settings/threads",
    searchTerms: [msg("usage quota rate limit reset wake recover continue")],
  },
  {
    id: "auto-mark-done-merged-threads",
    title: msg("Automatically mark merged threads as Done"),
    to: "/settings/threads",
    searchTerms: ["auto-mark-done", msg("pull request merge closed automatically sidebar")],
    requiresThreadAutoMarkDone: true,
    scope: "project-defaults",
  },
  {
    id: "auto-mark-done-inactive-threads",
    title: msg("Automatically mark inactive threads as Done"),
    to: "/settings/threads",
    searchTerms: ["auto-mark-done", msg("sidebar inactivity days no activity automatically")],
    requiresThreadAutoMarkDone: true,
    scope: "project-defaults",
  },
  {
    id: "auto-mark-done-keep-pull-requests",
    title: msg("Keep threads with an open PR"),
    to: "/settings/threads",
    targetId: "auto-mark-done-inactive-threads",
    searchTerms: ["auto-mark-done", msg("pull request review inactivity sidebar")],
    requiresThreadAutoMarkDone: true,
    scope: "project-defaults",
  },
  {
    id: "days-before-auto-mark-done",
    title: msg("Days of inactivity before marking Done"),
    to: "/settings/threads",
    targetId: "auto-mark-done-inactive-threads",
    searchTerms: ["auto-mark-done", msg("thread timeout activity sidebar")],
    requiresThreadAutoMarkDone: true,
    scope: "project-defaults",
  },
  {
    id: "continue-threads-after-server-update",
    title: msg("Continue threads after restarts"),
    to: "/settings/maintenance",
    scope: "project-defaults",
    searchTerms: [
      msg(
        "resume running active interrupted work restart reboot machine crash desktop update automatically",
      ),
    ],
  },
  {
    id: "send-shortcut",
    title: msg("Send shortcut"),
    to: "/settings/chat",
    searchTerms: [msg("enter return command ctrl multiline prompt new line composer")],
  },
  {
    id: "follow-up-behavior",
    title: msg("Follow-up behavior"),
    to: "/settings/chat",
    searchTerms: [msg("queue steer running turn send default behavior composer")],
  },
  {
    id: "composer-rich-text",
    title: msg("Rich text composer"),
    to: "/settings/chat",
    searchTerms: [msg("composer rich text tiptap bold italic markdown styled wysiwyg")],
  },
  {
    id: "skills-in-slash-menu",
    title: msg("Show skills in slash menu"),
    to: "/settings/chat",
    searchTerms: ["command menu dollar $ slash /"],
  },
  {
    id: "tool-call-visibility",
    title: msg("Tool calls in chat"),
    to: "/settings/chat",
    searchTerms: [
      msg(
        "hide tool calls commands edits searches work log activity quiet chat zen final answers only",
      ),
    ],
  },
  {
    id: "screen-reader-announcements",
    title: msg("Screen reader announcements"),
    to: "/settings/chat",
    searchTerms: [
      msg(
        "accessibility a11y screen reader nvda jaws voiceover orca narrator speech announce read aloud messages activity steps",
      ),
    ],
  },
  {
    id: "screen-reader-window-title",
    title: msg("Screen reader window title"),
    to: "/settings/chat",
    searchTerms: [
      msg(
        "accessibility a11y screen reader nvda jaws voiceover orca narrator window title tab title alt tab taskbar thread status order working approval",
      ),
    ],
  },
  {
    id: "proactive-panels",
    title: msg("Open pull requests and changes panels proactively"),
    to: "/settings/diffs",
    searchTerms: [
      msg("proactive automatically open diff pull request pr right panel agent completion"),
    ],
  },
  {
    id: "default-diff-file-state",
    title: msg("Collapse diff files"),
    to: "/settings/diffs",
    searchTerms: [
      msg("default diff file state collapsed expanded expand pull request pr code tab"),
    ],
  },
  {
    id: "hide-whitespace-changes",
    title: msg("Hide whitespace changes"),
    to: "/settings/diffs",
    searchTerms: [msg("diff ignore spaces edits default")],
  },
  {
    id: "thread-grouping",
    title: msg("Thread grouping"),
    to: "/settings/general",
    searchTerms: [msg("sidebar default status project inbox")],
  },
  {
    id: "project-grouping",
    title: msg("Project grouping"),
    to: "/settings/general",
    searchTerms: [msg("combine matching repositories environments sidebar")],
  },
  {
    id: "project-order",
    title: msg("Project order"),
    to: "/settings/general",
    searchTerms: [msg("sort projects sidebar manual created recent")],
  },
  {
    id: "add-project-starts-in",
    title: msg("Add project starts in"),
    to: "/settings/threads",
    scope: "environment-defaults",
    searchTerms: [msg("base directory folder browser path home")],
  },
  {
    id: "ghq-clone-layout",
    title: msg("Clone into host folders"),
    to: "/settings/threads",
    scope: "environment-defaults",
    searchTerms: [msg("ghq clone destination host owner repository root layout")],
  },
  {
    id: "unpin-confirmation",
    title: msg("Unpin confirmation"),
    to: "/settings/general",
    searchTerms: [msg("ask before thread pinned section")],
  },
  {
    id: "archive-confirmation",
    title: msg("Archive confirmation"),
    to: "/settings/general",
    searchTerms: [msg("ask before thread second click inline action")],
  },
  {
    id: "delete-confirmation",
    title: msg("Delete confirmation"),
    to: "/settings/general",
    searchTerms: [msg("ask before thread chat history")],
  },
  {
    id: "terminal-close-confirmation",
    title: msg("Terminal close confirmation"),
    to: "/settings/general",
    searchTerms: [msg("ask before delete stop process shell console history")],
  },
  {
    id: "language",
    title: msg("Language"),
    to: "/settings/general",
    searchTerms: [
      msg(
        "locale translation english deutsch german español spanish français french português portuguese brasil brazilian chinese 中文 japanese 日本語 korean 한국어 russian русский swedish svenska sprache idioma langue 语言 言語 언어 язык",
      ),
    ],
  },
  {
    id: "time-format",
    title: msg("Time format"),
    to: "/settings/general",
    searchTerms: [msg("timestamp clock locale system browser os 12 hour 24 hour")],
  },
  {
    id: "text-generation-model",
    title: msg("Text generation model"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [msg("generated thread titles source control content default provider")],
  },
  {
    id: "thread-title-instructions",
    title: msg("Thread title instructions"),
    to: "/settings/threads",
    scope: "project-defaults",
    searchTerms: [msg("generated thread titles prompt custom style naming rename regenerate")],
  },
  {
    id: "voice-transcription",
    title: msg("Voice transcription"),
    to: "/settings/voice",
    scope: "environment-defaults",
    searchTerms: [msg("voice dictation microphone speech transcribe provider account login")],
  },
  {
    id: "voice-language",
    title: msg("Voice language"),
    to: "/settings/voice",
    searchTerms: [msg("voice dictation microphone speech transcribe language locale spoken")],
  },
  {
    id: "voice-microphone",
    title: msg("Microphone"),
    to: "/settings/voice",
    searchTerms: [msg("voice dictation microphone input device mic headset usb select choose")],
  },
  {
    id: "voice-avoid-bluetooth",
    title: msg("Use the Mac's microphone instead of Bluetooth"),
    to: "/settings/voice",
    macOnly: true,
    searchTerms: [
      msg("voice dictation microphone bluetooth airpods headset built-in call quality"),
    ],
  },
  {
    id: "voice-hold-to-talk",
    title: msg("Hold to talk"),
    to: "/settings/voice",
    searchTerms: [
      msg(
        "voice dictation microphone speech push to talk option alt spacebar hold keyboard shortcut",
      ),
    ],
  },
  {
    id: "voice-dictionary",
    title: msg("Dictionary"),
    to: "/settings/voice",
    scope: "environment-defaults",
    searchTerms: [msg("voice dictation transcript custom words vocabulary names jargon spelling")],
  },
  {
    id: "next-prompt-suggestions",
    title: msg("Next prompt suggestions"),
    to: "/settings/threads",
    scope: "environment-defaults",
    searchTerms: [
      msg("next prompt suggested reply ghost text composer predict tab autocomplete follow up"),
    ],
  },
  {
    id: "provider-update-checks",
    title: msg("Provider update checks"),
    to: "/settings/maintenance",
    searchTerms: [
      msg("installed cli versions newer available codex claude cursor grok fx kiro opencode"),
    ],
    scope: "environment-defaults",
  },
  {
    id: "keep-awake-while-agents-work",
    title: msg("Keep awake while agents work"),
    to: "/settings/maintenance",
    scope: "environment-defaults",
    searchTerms: [msg("caffeinate sleep prevent stay awake power laptop lid inhibit")],
  },
  {
    id: "prune-event-history",
    title: msg("Delete history older than a day"),
    to: "/settings/maintenance",
    scope: "environment-defaults",
    searchTerms: [msg("prune event log database size shrink growth storage backup")],
  },
  {
    id: "background-activity",
    title: msg("Background activity"),
    to: "/settings/maintenance",
    scope: "environment-defaults",
    searchTerms: [
      msg(
        "balanced performance battery saver advanced git fetch provider health refresh host power monitor idle policy",
      ),
    ],
  },
  {
    id: "cli-command",
    title: msg("supaterm command"),
    to: "/settings/about",
    searchTerms: [msg("cli terminal shell path install command line")],
    desktopOnly: true,
  },
  {
    id: "mobile-app",
    title: msg("Mobile app"),
    to: "/settings/about",
    searchTerms: [msg("phone tablet iPhone iPad iOS TestFlight QR")],
  },
  {
    id: "welcome-page",
    title: msg("Welcome page"),
    to: "/settings/about",
    primaryEnvironmentOnly: true,
    searchTerms: [msg("onboarding setup first run getting started agents import projects")],
  },
  {
    id: "privacy-policy",
    title: msg("Privacy policy"),
    to: "/settings/about",
    searchTerms: [msg("telemetry analytics usage data tracking legal opt out")],
  },
  {
    id: "diagnostics",
    title: msg("Diagnostics"),
    to: "/settings/maintenance",
    searchTerms: [msg("logs traces processes resource history failures spans cpu memory")],
  },
  {
    id: "open-source-licenses",
    title: msg("Open source licenses"),
    to: "/settings/about",
  },
  {
    id: "project-overview",
    title: msg("Project overview"),
    to: "/settings/projects",
    searchTerms: [msg("name icon emoji image checkout remove delete")],
  },
  {
    id: "color-scheme",
    title: msg("Color scheme"),
    to: "/settings/appearance",
    searchTerms: [msg("appearance light dark system mode")],
    targetId: "appearance",
  },
  {
    id: "theme",
    title: msg("Themes"),
    to: "/settings/appearance",
    searchTerms: [
      msg("appearance colors palette custom import light dark"),
      BUILT_IN_THEMES.map((theme) => theme.label).join(" "),
    ],
    // The light and dark theme pickers sit directly under the scheme tiles;
    // the section is the stable scroll destination for both.
    targetId: "appearance",
  },
  {
    // Prefixed because the slider control already owns the `appearance-contrast` id.
    id: "setting-appearance-contrast",
    title: msg("Contrast"),
    to: "/settings/appearance",
    searchTerms: [msg("colors borders interface")],
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    title: msg("Glass opacity"),
    to: "/settings/appearance",
    searchTerms: [msg("transparent transparency solid menus dialogs composer")],
  },
  {
    id: "diff-color-scheme",
    title: msg("Diff colors"),
    to: "/settings/diffs",
    searchTerms: [
      msg("red green blue orange additions deletions changes counts palette colorblind"),
    ],
  },
  {
    id: "chat-width",
    title: msg("Chat width"),
    to: "/settings/appearance",
    searchTerms: [msg("wide full width column layout messages composer monitor")],
  },
  {
    id: "html-preview-width",
    title: msg("HTML preview width"),
    to: "/settings/appearance",
    searchTerms: [msg("wide full width inline page render chart dashboard artifact centered")],
  },
  {
    id: "thread-details-items",
    title: msg("Thread details"),
    to: "/settings/appearance",
    searchTerms: [
      msg(
        "customize show hide panel card environment editor scripts branch pull request git changes context fork servers automations lineage usage limits 5 hour weekly quota",
      ),
    ],
  },
  {
    id: "interface-font",
    title: msg("Interface font"),
    to: "/settings/appearance",
    searchTerms: [msg("typography family size system sans")],
  },
  {
    id: "prompt-font",
    title: msg("Prompt font"),
    to: "/settings/appearance",
    searchTerms: [msg("typography family size composer input")],
  },
  {
    id: "code-font",
    title: msg("Code font"),
    to: "/settings/appearance",
    searchTerms: [msg("typography family size monospace code blocks diffs file previews")],
  },
  {
    id: "terminal-font",
    title: msg("Terminal font"),
    to: "/settings/appearance",
    searchTerms: [msg("typography family size monospace output")],
  },
  {
    id: "font-smoothing",
    title: msg("Font smoothing"),
    to: "/settings/appearance",
    searchTerms: [msg("typography text grayscale anti aliasing macos thin")],
    macOnly: true,
  },
  {
    id: "math-rendering",
    title: msg("Render math"),
    to: "/settings/appearance",
    searchTerms: [msg("latex tex katex equations formulas markdown")],
  },
  {
    id: "word-wrap",
    title: msg("Word wrap"),
    to: "/settings/appearance",
    searchTerms: [msg("long lines code blocks diffs file previews")],
  },
  {
    id: "usage-limits",
    title: msg("Usage limits"),
    to: "/settings/appearance",
    searchTerms: [msg("composer context strip quota rate limits session weekly remaining")],
  },
  {
    id: "keybindings",
    title: msg("Keybindings"),
    to: "/settings/keybindings",
    searchTerms: [msg("keyboard shortcuts hotkeys commands bindings json")],
  },
  ...KEYBINDING_SEARCH_ITEMS,
  {
    id: "snap-shot-enabled",
    title: msg("SnapShots"),
    searchTerms: [msg("window capture screenshot")],
    to: "/settings/snap-shot",
  },
  {
    id: "snap-shot-accessibility",
    title: msg("Include app text"),
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: [
      msg("capture accessibility data text UI structure elements privacy omit agent context"),
    ],
  },
  {
    id: "snap-shot-shortcut",
    title: msg("Capture shortcut"),
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-sound",
    title: msg("Capture sound"),
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-flash",
    title: msg("Capture flash"),
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-animations",
    title: msg("Capture animations"),
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  ...CODEX_MICRO_SETTINGS_SEARCH_ITEMS,
  ...SIDE_PULSE_SETTINGS_SEARCH_ITEMS,
  {
    id: "providers",
    title: msg("Providers"),
    to: "/settings/providers",
    searchTerms: [
      "agents cli codex claude cursor grok fx kiro opencode antigravity google sign in sign out install subscription instances authentication api key models configuration binary path config directory codex_home shadow home endpoint arguments environment variables display name accent color custom favorite hidden auto compact native sessions import resume",
    ],
  },
  {
    id: "provider-health-check-interval",
    title: msg("Health check interval"),
    to: "/settings/providers",
    searchTerms: [
      msg("refresh availability versions auth state models background probes seconds off"),
    ],
    providerSettingsOnly: true,
  },
  {
    id: "orchestration-skills",
    title: msg("Orchestration skills"),
    to: "/settings/skills",
    searchTerms: [
      msg(
        "committee and advisor supaterm commitee install uninstall native skills agents delegation",
      ),
    ],
  },
  {
    id: "agent-browser-access",
    title: msg("Agent browser access"),
    to: "/settings/browser",
    scope: "project-defaults",
    searchTerms: [msg("allow disable enable open drive preview tools sessions project override")],
  },
  {
    id: "device-hosts",
    title: msg("Device hosts"),
    to: "/settings/devices",
    searchTerms: [
      msg("ssh remote simulator emulator ios android mac mini identity key connection"),
    ],
  },
  {
    id: "agent-device-access",
    title: msg("Agent device access"),
    to: "/settings/devices",
    targetId: "devices",
    searchTerms: [msg("allow simulator emulator ios android drive tools sessions")],
  },
  {
    id: "device-hub",
    title: msg("Device hub"),
    to: "/settings/devices",
    targetId: "devices",
    searchTerms: [msg("simulator emulator ios android install start")],
  },
  {
    id: "device-platform-support",
    title: msg("Simulator support"),
    to: "/settings/devices",
    targetId: "devices",
    searchTerms: [msg("xcode android studio sdk avd runtime")],
  },
  {
    id: "browser-profiles",
    title: msg("Browser profiles"),
    to: "/settings/browser",
    targetId: "browser",
  },
  {
    id: "browser-default-profile",
    title: msg("Default browser profile"),
    to: "/settings/browser",
    targetId: "browser-profiles",
  },
  {
    id: "browser-default-viewport",
    title: msg("Default browser viewport"),
    to: "/settings/browser",
    searchTerms: [msg("preview size width height device desktop mobile rotate")],
  },
  {
    id: "browser-default-zoom",
    title: msg("Default browser zoom"),
    to: "/settings/browser",
    searchTerms: [msg("preview page scale tabs percent")],
  },
  {
    id: "browser-default-appearance",
    title: msg("Default browser appearance"),
    to: "/settings/browser",
    searchTerms: [msg("preview color scheme light dark system os")],
  },
  {
    id: "browser-recording-frame-rate",
    title: msg("Browser recording frame rate"),
    to: "/settings/browser",
  },
  {
    id: "browser-recording-input",
    title: msg("Browser recording overlays"),
    to: "/settings/browser",
    searchTerms: [
      msg(
        "browser preview key presses keyboard shortcuts keystrokes mouse presses clicks buttons drag overlay capture",
      ),
    ],
  },
  {
    id: "browser-link-target",
    title: msg("Open links in"),
    to: "/settings/browser",
    searchTerms: [msg("links default browser in-app browser external open")],
  },
  {
    id: "browser-search-engine",
    title: msg("Search engine"),
    to: "/settings/browser",
    searchTerms: [msg("address bar duckduckgo google bing brave kagi ecosia custom url")],
  },
  {
    id: "pull-request-links-open-in-app",
    title: msg("Open pull requests in Supaterm"),
    to: "/settings/diffs",
    searchTerms: [
      msg("pr commit links {hosts} browser external click default pull request view panel", {
        hosts: SOURCE_CONTROL_HOST_LABELS,
      }),
    ],
  },
  {
    id: "browser-agent-open-target",
    title: msg("Show agent browsers and devices in"),
    to: "/settings/browser",
    searchTerms: [
      msg(
        "agent opens browser device simulator emulator sidebar right panel floating preview picture in picture pip background show hide",
      ),
    ],
  },
  {
    id: "automatic-pull",
    title: msg("Automatically pull"),
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: [msg("auto pull default branch current checkout fast forward upstream")],
  },
  {
    id: "remove-agent-credits-on-merge",
    title: msg("Remove agent credits when merging"),
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: [
      msg("pull request {hosts} squash co-authored-by attribution claude codex generated", {
        hosts: SOURCE_CONTROL_HOST_LABELS,
      }),
    ],
  },
  {
    id: "pull-request-merge-method",
    title: msg("Default merge method"),
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: [msg("pull request merge squash rebase last selected")],
  },
  {
    id: "issue-trackers",
    title: msg("Issue trackers"),
    to: "/settings/source-control",
    scope: "environment-defaults",
    searchTerms: [msg("linear jira issues tracker team api key connect bind project")],
  },
  {
    id: "source-control",
    title: msg("Source control"),
    to: "/settings/source-control",
    scope: "environment-defaults",
    searchTerms: [
      msg("version control git {hosts} hosting integrations credentials scan server environment", {
        hosts: SOURCE_CONTROL_HOST_TERMS,
      }),
    ],
  },
  {
    id: "git-fetch-interval",
    title: msg("Git fetch interval"),
    to: "/settings/source-control",
    searchTerms: [
      msg("automatic remote branch refresh background credentials security keys seconds off"),
    ],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "worktree-branch-naming",
    title: msg("Worktree branch naming"),
    to: "/settings/worktrees",
    searchTerms: [
      msg(
        "static repository name semantic prefix custom prompt instructions feat fix refactor chore",
      ),
    ],
    environmentOnly: true,
    scope: "project-defaults",
  },
  ...sourceControlHostSearchItems(sourceControlClients.definitions),
  {
    id: "source-control-writing-style",
    title: msg("Commit and pull request writing"),
    to: "/settings/source-control",
    searchTerms: [
      msg(
        "repository conventions conventional commits custom instructions commit messages change pr pull request merge request titles descriptions body style prompt write my own",
      ),
    ],
    environmentOnly: true,
  },
  {
    id: "follow-change-request-templates",
    title: msg("Follow pull request templates"),
    to: "/settings/source-control",
    searchTerms: [
      msg("repository pr pull request merge request change request description structure"),
    ],
    environmentOnly: true,
  },
  {
    id: "source-control-writer-model",
    title: msg("Source control writer model"),
    to: "/settings/source-control",
    searchTerms: [
      msg("override generated commit change request pr titles descriptions branch bookmark"),
    ],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "review-guides",
    title: msg("Review guides (beta)"),
    to: "/settings/source-control",
    searchTerms: [msg("pull request pr guided review guide tour beta experimental")],
    environmentOnly: true,
  },
  {
    id: "review-guide-model",
    title: msg("Review guide model"),
    to: "/settings/source-control",
    // Hidden until review guides are on, so a search lands on the switch that shows it.
    targetId: "review-guides",
    searchTerms: [msg("pull request pr guided review guide brief maintainer")],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "review-guide-instructions",
    title: msg("Review guide instructions"),
    to: "/settings/source-control",
    targetId: "review-guides",
    searchTerms: [msg("pull request pr guided review guide preferences taste prompt custom")],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "project-actions",
    title: msg("Actions"),
    to: "/settings/projects",
    searchTerms: [
      msg("commands scripts setup run dev server checkout worktree supaterm.json import"),
    ],
  },
  {
    id: "project-repositories",
    title: msg("Repositories"),
    to: "/settings/projects",
    searchTerms: [msg("tracked folders multi repo workspace code-workspace rescan add folder")],
  },
  {
    id: "environment-icon",
    title: msg("Environment icon"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [msg("machine glyph sidebar mac mini studio laptop desktop server cloud vm")],
  },
  {
    id: "linked-environments",
    peerLinksOnly: true,
    title: msg("Linked environments"),
    to: "/settings/connections",
    targetId: "linked-environments",
    searchTerms: [
      msg(
        "link peer another machine vps agents work there delegate handoff pairing code permissions",
      ),
    ],
  },
  {
    id: "local-environment",
    title: msg("Local environment"),
    to: "/settings/connections",
    searchTerms: [msg("turn off on disable enable local server agents remote only restart")],
    desktopOnly: true,
  },
  {
    id: "public-relay",
    title: msg("Encrypted Relay"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [msg("remote end-to-end encrypted tunnel pairing companion")],
    localBackendManagementOnly: true,
  },
  {
    id: "network-access",
    title: msg("Network access"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [msg("expose backend remote pairing local machine interfaces host restart")],
    localBackendManagementOnly: true,
  },
  {
    id: "built-in-tailscale",
    title: "Built-in Tailscale",
    to: "/settings/access",
    searchTerms: [
      "tailscale tailnet headscale magicdns ts.net https certificate remote vpn serve over tailscale sign in sign out limit access machine name control server",
    ],
  },
  {
    id: "tailscale-https",
    title: msg("Tailscale app HTTPS"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [msg("tailscale serve magicdns endpoint remote secure network older")],
    desktopOnly: true,
    localBackendManagementOnly: true,
  },
  {
    id: "wsl-backend",
    title: msg("WSL backend"),
    to: "/settings/access",
    searchTerms: [
      msg(
        "windows subsystem linux distro second server projects stop windows backend restart wsl only",
      ),
    ],
    desktopOnly: true,
    windowsOnly: true,
    localBackendManagementOnly: true,
    wslAvailableOnly: true,
  },
  {
    id: "preview-tunnel",
    title: msg("Preview tunnel"),
    to: "/settings/access",
    targetId: "connections-environment",
    searchTerms: [
      msg("localhost loopback port forwarding open on this device browser tabs stream security"),
    ],
  },
  {
    id: "connections-environment",
    title: msg("This machine"),
    to: "/settings/access",
    searchTerms: [
      msg(
        "connections server backend local remote access administrative permissions scope pairing links qr code authorized clients sessions revoke endpoint",
      ),
    ],
  },
  {
    id: "remote-environments",
    title: msg("Environments"),
    to: "/settings/connections",
    searchTerms: [msg("add pair backend host code ssh config agent tunnel saved")],
  },
  {
    id: "load-balancing",
    title: msg("Load balancing"),
    to: "/settings/connections",
    searchTerms: [
      msg(
        "automatic machine environment resources cpu memory capacity preference weight shared projects",
      ),
    ],
  },
  {
    id: "pull-request-routing",
    title: msg("Pull request sharing"),
    to: "/settings/connections",
    searchTerms: [
      msg(
        "pull request routing trusted environments shared credentials permissions read actions source control {hosts}",
        { hosts: SOURCE_CONTROL_HOST_LABELS },
      ),
    ],
  },
  {
    id: "secret-providers",
    title: msg("Secret providers"),
    to: "/settings/secrets",
    searchTerms: [msg("1password vault credentials api key")],
    secretProvidersOnly: true,
  },
  {
    id: "secret-providers-add",
    title: msg("Add secret provider"),
    to: "/settings/secrets",
    targetId: "secret-providers",
    searchTerms: [msg("new 1password vault op cli account")],
    secretProvidersOnly: true,
  },
  {
    id: "archive",
    title: msg("Archived threads"),
    to: "/settings/archived",
    searchTerms: [msg("restore reopen deleted history projects")],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = new Map(SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item] as const));

const SETTINGS_CATEGORY_SCOPES: Readonly<Record<SettingsPath, SettingsSearchScope | null>> = {
  "/settings/diagnostics": "environment",
  "/settings/projects": "project",
  "/settings/general": null,
  "/settings/appearance": null,
  "/settings/chat": null,
  "/settings/diffs": null,
  "/settings/snap-shot": null,
  "/settings/codex-micro": null,
  "/settings/sidepulse": null,
  "/settings/keybindings": null,
  "/settings/providers": null,
  "/settings/threads": null,
  "/settings/skills": null,
  "/settings/voice": null,
  "/settings/browser": null,
  "/settings/devices": null,
  "/settings/source-control": "environment-defaults",
  "/settings/worktrees": "project-defaults",
  "/settings/connections": "connections",
  "/settings/access": "connections",
  "/settings/secrets": null,
  "/settings/maintenance": null,
  "/settings/about": null,
  "/settings/archived": "project-defaults",
};

const RENAMED_SETTINGS_PATHS: Readonly<Record<string, SettingsPath>> = {
  "/settings/integrations": "/settings/browser",
  "/settings/storage": "/settings/maintenance",
};
const SPLIT_SETTINGS_PATHS: ReadonlySet<string> = new Set([
  "/settings/general",
  "/settings/appearance",
  "/settings/chat",
  "/settings/threads",
  "/settings/source-control",
  "/settings/connections",
  ...Object.keys(RENAMED_SETTINGS_PATHS),
]);
// Section anchors that moved but are not search results themselves.
const MOVED_SECTION_ANCHORS: Readonly<Record<string, SettingsPath>> = {
  "authorized-clients": "/settings/access",
  threads: "/settings/threads",
  "voice-input": "/settings/voice",
  devices: "/settings/devices",
  composer: "/settings/chat",
  review: "/settings/diffs",
  about: "/settings/about",
};

/** Where an old settings link now lives. Its anchor finds the page its row moved to. */
export function movedSettingsPath(pathname: string, hash: string): SettingsPath | null {
  if (!SPLIT_SETTINGS_PATHS.has(pathname)) return null;
  const items: readonly SettingsSearchItem[] = SETTINGS_SEARCH_ITEMS;
  const anchored = hash
    ? (items.find((item) => item.id === hash) ?? items.find((item) => item.targetId === hash))
    : undefined;
  const to =
    anchored?.to ?? MOVED_SECTION_ANCHORS[hash] ?? RENAMED_SETTINGS_PATHS[pathname] ?? null;
  return to === pathname ? null : to;
}

export function getSettingsSearchTargetScope(targetId: string) {
  const items: readonly SettingsSearchItem[] = SETTINGS_SEARCH_ITEMS;
  const item =
    items.find((candidate) => candidate.id === targetId) ??
    items.find((candidate) => candidate.targetId === targetId);
  return item
    ? {
        title: item.title,
        scope: item.scope ?? SETTINGS_CATEGORY_SCOPES[item.to],
        ...(item.requiresThreadAutoMarkDone ? { requiresThreadAutoMarkDone: true } : {}),
      }
    : null;
}

interface AutoMarkDoneSearchEnvironment {
  readonly environmentId: EnvironmentId;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: object | null;
}

export function getThreadAutoMarkDoneSearchAvailability(
  environments: readonly AutoMarkDoneSearchEnvironment[],
  scope?: Pick<ResolvedSettingsScope, "kind" | "environmentIds">,
) {
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );
  const eligibleEnvironmentIds = connected.map((environment) => environment.environmentId);
  const selected = connected.filter((environment) =>
    scope?.environmentIds.includes(environment.environmentId),
  );
  return {
    eligibleEnvironmentIds,
    isTargetAvailable: scope !== undefined && scope.kind !== "unavailable" && selected.length > 0,
  };
}

export function isSettingsSearchScopeAvailable(
  requiredScope: SettingsSearchScope | null,
  scopeKind: ResolvedSettingsScope["kind"],
): boolean {
  switch (requiredScope) {
    case null:
    case "connections":
      return true;
    case "environment":
    case "checkout":
      return requiredScope === scopeKind;
    case "project":
      return scopeKind === "project" || scopeKind === "checkout";
    case "environment-defaults":
      return scopeKind === "environment" || scopeKind === "all";
    case "project-defaults":
      return (
        scopeKind === "environment" ||
        scopeKind === "all" ||
        scopeKind === "project" ||
        scopeKind === "checkout"
      );
  }
}

export function searchableSetting(id: SettingsSearchItemId): {
  readonly id: string;
  readonly title: string;
} {
  const { id: anchorId, title } = SEARCH_ITEMS_BY_ID.get(id)!;
  return { id: anchorId, title };
}

export function useSearchableSetting() {
  const m = useMessages();
  return (id: SettingsSearchItemId) => {
    const setting = searchableSetting(id);
    return { ...setting, title: m(setting.title) };
  };
}

export function filterAvailableSettingsSearchItems(
  availability: SettingsSearchAvailability,
): ReadonlyArray<SettingsSearchItem> {
  const items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS;
  return items.filter(
    (item) =>
      (!item.environmentOnly || availability.hasEnvironment) &&
      (!item.providerSettingsOnly || availability.hasProviderSettingsEnvironment) &&
      (!item.localBackendManagementOnly || availability.canManageLocalBackend) &&
      (!item.primaryEnvironmentOnly || availability.hasPrimaryEnvironment === true) &&
      (!item.wslAvailableOnly || availability.isWslSettingsRowVisible) &&
      (!item.requiresThreadAutoMarkDone || availability.hasThreadAutoMarkDone) &&
      (!item.fastWorktreeCheckoutOnly ||
        availability.hasFastWorktreeCheckoutEnvironment === true) &&
      (!item.peerLinksOnly || availability.hasPeerLinkHost === true) &&
      (!item.secretProvidersOnly || availability.hasSecretProvidersEnvironment === true),
  );
}

/** The settings that exist on this platform and app channel. */
export function settingsForThisPlatform(
  items: ReadonlyArray<SettingsSearchItem>,
): ReadonlyArray<SettingsSearchItem> {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;
  return items.filter(
    (item) =>
      isSettingsSectionAvailable(item.to) &&
      (isElectron || item.desktopOnly !== true) &&
      (!item.releaseChannelOnly || isElectron || HOSTED_APP_CHANNEL !== null) &&
      (!item.macOnly || isMacPlatform(platform)) &&
      (!item.windowsOnly || isWindowsPlatform(platform)),
  );
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
  translate: (message: string) => string = (message) => message,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];
  const queryTokens = normalizedQuery.split(" ");

  return settingsForThisPlatform(items)
    .flatMap((item, index) => {
      const title = normalizeSearchText(decodeMsg(item.title));
      const fields = [
        title,
        normalizeSearchText(SETTINGS_SECTION_LABELS[item.to]),
        // The labels as displayed, so search also works in the active language.
        normalizeSearchText(translate(item.title)),
        normalizeSearchText(translate(SETTINGS_SECTION_LABELS[item.to])),
        ...(item.searchTerms ?? []).map(normalizeSearchText),
        ...(item.searchTerms ?? []).map((term) => normalizeSearchText(translate(term))),
      ];
      if (!queryTokens.every((token) => fields.some((field) => field.includes(token)))) return [];

      const exactPhraseField = fields.findIndex((field) => field.includes(normalizedQuery));
      const rank =
        title === normalizedQuery
          ? 5
          : title.startsWith(normalizedQuery)
            ? 4
            : title.includes(normalizedQuery)
              ? 3
              : queryTokens.every((token) => title.includes(token))
                ? 2
                : exactPhraseField >= 0
                  ? 1
                  : 0;
      return [{ item, index, rank }];
    })
    .toSorted(
      (left, right) =>
        Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false) ||
        right.rank - left.rank ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}

// Font smoothing only renders on macOS, so a search jump to it elsewhere
// must not flip the section - the target would never mount to be scrolled to.
const ADVANCED_TYPOGRAPHY_TARGET_IDS: ReadonlySet<string> = new Set([
  "prompt-font",
  "terminal-font",
  ...(typeof navigator !== "undefined" && isMacPlatform(navigator.platform)
    ? ["font-smoothing"]
    : []),
]);

export function isAdvancedTypographyTarget(targetId: string): boolean {
  return ADVANCED_TYPOGRAPHY_TARGET_IDS.has(targetId);
}

/**
 * Opens the persisted section a search result lives in before jumping to it, so
 * its row is mounted to scroll to. The terminal reads the same flag, so it must
 * stay on after the jump.
 */
export function revealSettingsSearchTarget(targetId: string): void {
  if (isAdvancedTypographyTarget(targetId)) {
    writeLocalStorageValue(TYPOGRAPHY_ADVANCED_STORAGE_KEY, true, false, Schema.Boolean);
  }
}
