import ArgumentParser
import SupatermCLIShared

enum SPHelp {
  private static let terminalStartupDiscussion = """
    With no command, the tab or pane starts the account login shell.

    Arguments after `--` remain exact. The first must name an executable.
    Supaterm uses the caller's PATH, skips shell startup, and closes the tab or pane when the process exits.

    Use `--script` for builtins, aliases, or raw shell code.
    Supaterm enters it in the account login shell, which remains open after the script ends.

    For shells without prompt-ready integration, startup files must not read from the terminal before the first prompt.
    Such a read takes the queued script.
    """

  static let socketDefaultValueDescription = "$\(SupatermCLIEnvironment.socketPathKey)"

  static let rootDiscussion = """
    Environment:
      \(SupatermCLIEnvironment.cliPathKey)  Auto-set in Supaterm panes. Path to the bundled sp CLI.
      \(SupatermCLIEnvironment.socketPathKey)  Auto-set in Supaterm panes. Default --socket.
      \(SupatermCLIEnvironment.stateHomeKey)  Optional root for Supaterm state.
      \(SupatermCLIEnvironment.surfaceIDKey)  Auto-set in Supaterm panes. Current pane ID.
      \(SupatermCLIEnvironment.tabIDKey)  Auto-set in Supaterm panes. Current tab ID.

    Example:
      sp ls
      sp group new Work --color blue
      sp tab new --focus -- ping 1.1.1.1
      sp pane split down -- tail -f /tmp/server.log
      sp project icon
      sp skills
      sp diagnostic
      sp instance ls
    """

  static let treeDiscussion = """
    `sp ls` is the compact live snapshot for agents and people.

    Human and plain output show typed short refs: s: for spaces, g: for groups,
    t: for tabs, and p: for panes. A short ref has 8 to 32 UUID hex characters.
    Use a longer ref if a prefix becomes ambiguous.

    JSON returns a flat item list with canonical UUIDs, parent IDs, current target,
    cwd, warm state, and coding-agent state. Its revision is an
    opaque live snapshot token.

    Every window lists every space in catalog order and marks the one it displays.
    A window keeps its own tabs inside each space, so the same space holds different
    tabs in different windows. windowIndex scopes each repeated space occurrence.

    Example:
      sp ls
      sp ls --json
      sp ls --plain
      sp ls --instance work-mac
    """

  static let onboardDiscussion = """
    Show Supaterm onboarding, shortcuts, and coding-agent setup commands.

    Example:
      sp onboard
      sp onboard --instance work-mac
      sp onboard --plain
    """

  static let diagnosticDiscussion = """
    Example:
      sp diagnostic
      sp diagnostic --json
      sp diagnostic --instance work-mac
    """

  static let instancesDiscussion = """
    Example:
      sp instance ls
      sp instance ls --json
      sp instance ls --plain
    """

  static let newPaneDiscussion = """
    If you omit --in inside Supaterm, this command splits the current pane.

    That ambient pane target comes from \(SupatermCLIEnvironment.surfaceIDKey) and \(SupatermCLIEnvironment.tabIDKey).

    `--in` accepts a tab target or pane target, including t: and p: refs.

    \(terminalStartupDiscussion)

    The new pane does not take focus by default. Add `--focus` to make it active.
    `--plain` prints the new pane UUID for follow-up commands.

    Example:
      sp pane split right
      sp pane split --focus right
      sp pane split right --cwd ~/tmp
      sp pane split down -- htop
      sp pane split down --script 'echo hi; pwd'
      sp pane split --layout keep right
      sp pane split --in 1/2 left
      sp pane split --in <tab-uuid> left
      sp pane split --in 1/2/3 down -- tail -f /tmp/server.log
    """

  static let newTabDiscussion = """
    If you omit --in inside Supaterm, this command creates the tab in the current tab's group when it has one.
    Otherwise it creates the tab in the current space.

    Use --root to always create the tab at the space root.

    The ambient tab and pane come from \(SupatermCLIEnvironment.surfaceIDKey) and \(SupatermCLIEnvironment.tabIDKey).

    `--in` accepts a space target, including an s: ref, resolved inside this window. The space
    opens its saved tabs first when this window has not displayed it yet. Add `--focus`
    to switch the window to that space as well.

    `--plain` prints the new pane UUID for follow-up commands.

    \(terminalStartupDiscussion)

    Example:
      sp tab new -- ping 1.1.1.1
      sp tab new --script 'echo hi; pwd'
      sp tab new --focus -- ping 1.1.1.1
      sp tab new --group Build
      sp tab new --root
      sp tab new --in 1 --cwd ~/tmp -- ping 1.1.1.1
      sp tab new --in <space-uuid> --cwd ~/tmp -- ping 1.1.1.1
    """

  static let groupDiscussion = """
    Groups are addressed by g: ref, UUID, or exact title. A unique title is required.

    Example:
      sp group new Build
      sp group rename Deploy Build
      sp group color blue Deploy
      sp group collapse Deploy
      sp group move Deploy --index 1
      sp group ungroup Deploy
      sp group close Deploy --yes
    """

  static let groupNewDiscussion = """
    Creates an empty group in the current space unless --in selects another space.

    Example:
      sp group new Build
      sp group new Deploy --color blue
      sp group new Pinned --pin
      sp group new Logs --in 2
    """

  static let groupRenameDiscussion = """
    If you omit the group target inside Supaterm, the current tab's group is used.

    Example:
      sp group rename Deploy
      sp group rename Deploy Build
      sp group rename Deploy <group-uuid>
    """

  static let groupColorDiscussion = """
    If you omit the group target inside Supaterm, the current tab's group is used.

    Example:
      sp group color blue
      sp group color green Deploy
      sp group color neutral <group-uuid>
    """

  static let groupTargetDiscussion = """
    If you omit the group target inside Supaterm, the current tab's group is used.

    Group targets accept a g: ref, UUID, or unique title.

    Example:
      sp group pin Build
      sp group unpin Build
      sp group collapse Build
      sp group expand Build
      sp group ungroup Build
      sp group close Build --yes
    """

  static let groupMoveDiscussion = """
    Moves a group to a 1-based index within its pinned or regular root lane.

    If you omit the group target inside Supaterm, the current tab's group is used.

    Example:
      sp group move --index 1
      sp group move Deploy --index 2
      sp group move <group-uuid> --index 1
    """

  static let moveTabDiscussion = """
    If you omit the tab target inside Supaterm, the current tab is used.

    Move to a group by g: ref, UUID, or unique title, or use --root. --index is 1-based.

    Example:
      sp tab move --group Build
      sp tab move 1/2 --group <group-uuid> --index 1
      sp tab move --root
      sp tab move <tab-uuid> --root --pin --index 1
    """

  static let notifyDiscussion = """
    If you omit the pane target inside Supaterm, this command targets the current pane.

    Pane targets accept a `space/tab/pane` selector, p: ref, or UUID.

    Example:
      sp pane notify --body "All tests passed"
      sp pane notify --title "Deploy complete"
      sp pane notify 1/2/3 --body "Deploy complete"
      sp pane notify <pane-uuid> --body "Deploy complete"
    """

  static let focusPaneDiscussion = """
    If you omit the pane target inside Supaterm, this command focuses the current pane.

    Pane targets accept a `space/tab/pane` selector, p: ref, or UUID.

    Example:
      sp pane focus 1/2/3
      sp pane focus <pane-uuid>
    """

  static let closePaneDiscussion = """
    If you omit the pane target inside Supaterm, this command closes the current pane.

    Pane targets accept a `space/tab/pane` selector, p: ref, or UUID.

    Example:
      sp pane close
      sp pane close 1/2/3
      sp pane close <pane-uuid>
    """

  static let selectTabDiscussion = """
    If you omit the tab target inside Supaterm, this command focuses the current tab.

    Tab targets accept a `space/tab` selector, t: ref, or UUID.

    Example:
      sp tab focus 1/2
      sp tab focus <tab-uuid>
    """

  static let pinTabDiscussion = """
    If you omit the tab target inside Supaterm, this command pins the current tab.

    Tab targets accept a `space/tab` selector, t: ref, or UUID.

    Example:
      sp tab pin
      sp tab pin 1/2
      sp tab pin <tab-uuid>
    """

  static let unpinTabDiscussion = """
    If you omit the tab target inside Supaterm, this command unpins the current tab.

    Tab targets accept a `space/tab` selector, t: ref, or UUID.

    Example:
      sp tab unpin
      sp tab unpin 1/2
      sp tab unpin <tab-uuid>
    """

  static let closeTabDiscussion = """
    If you omit the tab target inside Supaterm, this command closes the current tab.

    Tab targets accept a `space/tab` selector, t: ref, or UUID.

    Example:
      sp tab close
      sp tab close 1/2
      sp tab close <tab-uuid>
    """

  static let sendTextDiscussion = """
    If you omit the pane target inside Supaterm, this command targets the current pane.

    Pane targets accept a `space/tab/pane` selector, p: ref, or UUID.

    Example:
      sp pane send --newline 'echo hello'
      sp pane send --submit <pane-uuid> - < prompt.md
      sp pane send 1/2/3 'pwd'
      sp pane send <pane-uuid> 'clear'
      printf 'pwd' | sp pane send
    """

  static let sendKeyDiscussion = """
    If you omit the pane target inside Supaterm, this command targets the current pane.

    Pane targets accept a `space/tab/pane` selector, p: ref, or UUID.

    Supported keys: \(SPPaneKeyArgument.supportedKeys).

    Example:
      sp pane key ctrl-c
      sp pane key enter 1/2/3
      sp pane key escape <pane-uuid>
    """

  static let capturePaneDiscussion = """
    If you omit the pane target inside Supaterm, this command captures the current pane.

    Pane targets accept a `space/tab/pane` selector, p: ref, or UUID.

    Example:
      sp pane capture
      sp pane capture --scope scrollback --lines 200
      sp pane capture <pane-uuid> --json
    """

  static let screenshotPaneDiscussion = """
    If you omit the pane target inside Supaterm, this command captures the current pane.

    The pane can be hidden in another space or tab.

    Taking a screenshot does not change the selected space, tab, pane, or application focus.

    Pane targets accept a `space/tab/pane` selector, p: ref, or UUID.

    Example:
      sp pane screenshot --output pane.png
      sp pane screenshot 1/2/3 --output pane.png
      sp pane screenshot <pane-uuid> -o pane.png --json
    """

  static let paneHealthDiscussion = """
    If you omit the pane target inside Supaterm, this command inspects the current pane.

    Pane targets accept a `space/tab/pane` selector, p: ref, or UUID.

    Example:
      sp pane health
      sp pane health <pane-uuid> --json
    """

  static let paneWaitReadyDiscussion = """
    If you omit the pane target inside Supaterm, this command waits for the current pane.

    Pane targets accept a `space/tab/pane` selector, p: ref, or UUID.

    Example:
      sp pane wait-ready
      sp pane wait-ready <pane-uuid> --timeout 5
    """

  static let resizePaneDiscussion = """
    If you omit the pane target inside Supaterm, this command resizes the current pane.

    Pane targets accept a `space/tab/pane` selector, p: ref, or UUID.

    Example:
      sp pane resize right 10
      sp pane resize down 5 1/2/3
      sp pane resize left 8 <pane-uuid>
    """

  static let renameTabDiscussion = """
    If you omit the tab target inside Supaterm, this command renames the current tab.
    Pass an empty title to clear the lock and restore the live terminal title.

    Tab targets accept a `space/tab` selector, t: ref, or UUID.

    Example:
      sp tab rename Build
      sp tab rename ''
      sp tab rename Logs 1/2
      sp tab rename Deploy <tab-uuid>
    """

  static let tabTitleDiscussion = """
    If you omit the tab target inside Supaterm, this command prints the current tab title.

    Tab targets accept a `space/tab` selector, t: ref, or UUID.

    Example:
      sp tab title
      sp tab title 1/2
      sp tab title <tab-uuid> --json
    """

  static let sshDiscussion = """
    `sp ssh` launches ssh from PATH with a compatible TERM and forwards terminal environment variables.

    Place SSH options and arguments after `--`.

    Example:
      sp ssh -- example.com
      sp ssh -- -p 2222 example.com
      sp ssh --term xterm-ghostty -- example.com
    """

  static let configDiscussion = """
    Example:
      sp config path
      sp config list
      sp config list --changed
      sp config get updates.channel
      sp config set appearance.mode system
      sp config reset privacy.analytics_enabled
      sp config validate
      sp config validate --path ~/.config/supaterm/settings.toml
      sp config validate --json
    """

  static let projectDiscussion = """
    Project commands read the local filesystem and do not need a running Supaterm app.

    Example:
      sp project icon
      sp project icon ~/code/project
      sp project icon --json
    """

  static let projectIconDiscussion = """
    Reads icon declarations from common HTML and root route files, including
    linked local web manifests. If none resolve, it checks common icon paths.

    The path must stay within the project directory and use a supported image extension.

    Example:
      sp project icon
      sp project icon ~/code/project
      sp project icon --plain
      sp project icon --json
    """

  static let validateConfigDiscussion = """
    Validate `~/.config/supaterm/settings.toml` by default.

    Use `--path` to validate another file.

    Example:
      sp config validate
      sp config validate --path ./settings.toml
      sp config validate --json
    """

  private static let receiveAgentHookExample =
    #"printf '{"hook_event_name":"Notification","message":"Claude needs your attention"}'"#

  static let receiveAgentHookDiscussion = """
    Reads one agent hook event JSON object from stdin and forwards it to Supaterm.

    Manage coding-agent integrations from Supaterm Settings > Coding Agents.
    Use `sp skills install` to install Supaterm's bundled discovery skill.
    Use `sp agent install-hooks` to install every supported hook bridge.
    Use `sp agent install-hook` and `sp agent remove-hook` for one agent.

    Example:
      sp skills install
      sp agent install-hooks
      sp agent install-hook claude
      sp agent remove-hook claude
      \(receiveAgentHookExample) | sp agent receive-agent-hook --agent claude
      \(SupatermClaudeHookSettings.command)
    """

  static let installAgentHookDiscussion = """
    Install Supaterm's hook bridge into the selected agent's user configuration.

    Example:
      sp agent install-hook claude
      sp agent install-hook codex
    """

  static let installAgentHooksDiscussion = """
    Install Supaterm's hook bridge into every supported agent user configuration.

    Example:
      sp agent explain
      sp agent reload-rules
      sp agent install-hooks
    """

  static let removeAgentHookDiscussion = """
    Remove Supaterm's hook bridge from the selected agent's user configuration.

    Example:
      sp agent remove-hook claude
      sp agent remove-hook codex
    """

  static let installAgentHookClaudeDiscussion = """
    Installs Supaterm hooks into ~/.claude/settings.json.

    Example:
      sp agent install-hook claude
    """

  static let installAgentHookCodexDiscussion = """
    Enables Codex hooks and installs Supaterm hooks into ~/.codex/hooks.json.

    Example:
      sp agent install-hook codex
    """

  static let removeAgentHookClaudeDiscussion = """
    Removes Supaterm hooks from ~/.claude/settings.json.

    Example:
      sp agent remove-hook claude
    """

  static let removeAgentHookCodexDiscussion = """
    Removes Supaterm hooks from ~/.codex/hooks.json.

    Example:
      sp agent remove-hook codex
    """

  static let agentSettingsDiscussion = """
    Example:
      sp internal agent-settings claude
      sp internal agent-settings codex
    """

  static let developmentDiscussion = """
    These commands require the connected Supaterm instance to report a development build.

    Example:
      sp internal dev claude session-start
    """

  static let developmentClaudeDiscussion = """
    Run these commands inside the Supaterm pane you want to verify.

    These commands require the connected Supaterm instance to report a development build.

    Example:
      sp internal dev claude session-start
    """

  static let developmentClaudeSessionStartDiscussion = """
    Example:
      sp internal dev claude session-start
    """

  static let instanceDiscussion = """
    Example:
      sp instance ls
      sp instance ls --plain
    """

  static let spaceDiscussion = """
    Spaces are shared: every window can display any space, one at a time, and each
    window keeps its own tabs inside each space. Space commands switch the window
    they run in; they never open or touch another window.

    Example:
      sp space ls
      sp space new Work
      sp space focus 1
      sp space rename Work 1
      sp space color green 1
      sp space destroy -y 1
      sp space next
    """

  static let spaceListDiscussion = """
    Lists every space in catalog order with the index used by space selectors.
    `*` marks the space this window displays. `cold` means this window has not
    opened that space yet in this run; its tabs come from the saved layout.

    Example:
      sp space ls
      sp space ls --output json
    """

  static let tabDiscussion = """
    Example:
      sp tab new --focus -- ping 1.1.1.1
      sp tab focus 1/2
      sp tab pin 1/2
      sp tab unpin 1/2
      sp tab title
      sp tab rename Logs 1/2
      sp tab next 1
    """

  static let paneDiscussion = """
    Example:
      sp pane split down -- htop
      sp pane focus 1/2/3
      sp pane send --newline 'echo hello'
      sp pane key ctrl-c
      sp pane screenshot --output pane.png
      sp pane health <pane-uuid> --json
      sp pane wait-ready <pane-uuid> --timeout 5
      sp pane layout equalize 1/2
    """

  static let spaceNewDiscussion = """
    Adds the space to the shared catalog and displays it in this window. It never
    opens a window.

    Example:
      sp space new Work
      sp space new --color green Work
    """

  static let spaceFocusDiscussion = """
    Switches this window to the space in place. Space indexes follow catalog order,
    the same order as the switcher dots. Other windows keep displaying their own space.

    Example:
      sp space focus
      sp space focus 1
      sp space focus <space-uuid>
    """

  static let spaceDestroyDiscussion = """
    Destroying a space kills its tabs in every window. Windows displaying it fall
    back to the neighboring space; no window closes.

    Example:
      sp space destroy -y
      sp space destroy -y 1
      sp space destroy -y <space-uuid>
    """

  static let spaceRenameDiscussion = """
    Example:
      sp space rename Work
      sp space rename Logs 1
      sp space rename Build <space-uuid>
    """

  static let spaceColorDiscussion = """
    Example:
      sp space color green
      sp space color purple 1
      sp space color neutral <space-uuid>
    """

  static let spaceNavigationDiscussion = """
    Moves this window through the catalog in place. `last` returns to the space this
    window displayed before the current one.

    Example:
      sp space next
      sp space prev
      sp space last
    """

  static let tabNavigationDiscussion = """
    Example:
      sp tab next
      sp tab prev 1
      sp tab last <space-uuid>
    """

  static let paneLayoutDiscussion = """
    Example:
      sp pane layout equalize
      sp pane layout tile 1/2
      sp pane layout main-vertical <tab-uuid>
    """

  static let agentDiscussion = """
    Example:
      sp agent install-hooks
      sp agent install-hook claude
      sp agent install-hook codex
    """

  static let skillsDiscussion = """
    List version-matched skill content bundled with Supaterm.

    Example:
      sp skills
      sp skills --json
      sp skills get core
      sp skills get coding-agents
      sp skills path core
      sp skills install
    """

  static let listSkillsDiscussion = """
    Example:
      sp skills
      sp skills list
      sp skills list --json
    """

  static let getSkillDiscussion = """
    Print a bundled skill. Use --full to include its references.

    Example:
      sp skills get core
      sp skills get core --full
      sp skills get coding-agents
    """

  static let pathSkillDiscussion = """
    Resolve the bundled directory when reading one reference directly.

    Example:
      sp skills path core
    """

  static let installSkillDiscussion = """
    Copy Supaterm's stable discovery skill to ~/.agents/skills/supaterm.

    Example:
      sp skills install
      sp skills install --json
    """

  static let internalDiscussion = """
    Example:
      sp internal ping
      sp internal agent-settings claude
      sp internal dev claude session-start
    """
}
