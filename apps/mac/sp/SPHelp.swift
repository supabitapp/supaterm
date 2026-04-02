import ArgumentParser
import SupatermCLIShared

enum SPHelp {
  static let socketDefaultValueDescription = "$\(SupatermCLIEnvironment.socketPathKey)"

  static let rootDiscussion = """
    Environment:
      \(SupatermCLIEnvironment.cliPathKey)  Auto-set in Supaterm panes. Path to the bundled sp CLI.
      \(SupatermCLIEnvironment.socketPathKey)  Auto-set in Supaterm panes. Default --socket.
      \(SupatermCLIEnvironment.surfaceIDKey)  Auto-set in Supaterm panes. Current pane ID.
      \(SupatermCLIEnvironment.tabIDKey)  Auto-set in Supaterm panes. Current tab ID.

    Example:
      sp tree
      sp new-tab --space 1 --focus
      sp new-pane --space 1 --tab 1 down
      sp debug
      sp instances
    """

  static let treeDiscussion = """
    `sp tree --json` includes UUIDs for spaces, tabs, and panes.

    Example:
      sp tree
      sp tree --json
      sp tree --instance work-mac
    """

  static let onboardDiscussion = """
    Example:
      sp onboard
      sp onboard --instance work-mac
    """

  static let debugDiscussion = """
    Example:
      sp debug
      sp debug --json
      sp debug --instance work-mac
    """

  static let instancesDiscussion = """
    Example:
      sp instances
      sp instances --json
    """

  static let newPaneDiscussion = """
    If you omit --space and --tab inside Supaterm, this command splits the current pane.

    That ambient pane target comes from \(SupatermCLIEnvironment.surfaceIDKey) and \(SupatermCLIEnvironment.tabIDKey).

    Explicit --space, --tab, and --pane targets accept either a 1-based index or UUID.

    Example:
      sp new-pane right
      sp new-pane down htop
      sp new-pane down --script $'echo 1\necho 2'
      sp new-pane --no-equalize right
      sp new-pane --space 1 --tab 2 left
      sp new-pane --tab <tab-uuid> left
      sp new-pane --space 1 --tab 2 --pane 3 down tail -f /tmp/server.log
    """

  static let newTabDiscussion = """
    If you omit --space inside Supaterm, this command creates the tab in the current space.

    That ambient pane target comes from \(SupatermCLIEnvironment.surfaceIDKey) and \(SupatermCLIEnvironment.tabIDKey).

    Explicit --space targets accept either a 1-based index or UUID.

    Example:
      sp new-tab ping 1.1.1.1
      sp new-tab --script $'echo 1\necho 2'
      sp new-tab --focus ping 1.1.1.1
      sp new-tab --space 1 --cwd ~/tmp ping 1.1.1.1
      sp new-tab --space <space-uuid> --cwd ~/tmp ping 1.1.1.1
    """

  static let notifyDiscussion = """
    Explicit --space, --tab, and --pane targets accept either a 1-based index or UUID.

    Example:
      sp notify --body "All tests passed"
      sp notify --space 1 --tab 2 --pane 3 --body "Deploy complete"
      sp notify --pane <pane-uuid> --body "Deploy complete"
    """

  static let focusPaneDiscussion = """
    If you omit --space, --tab, and --pane inside Supaterm, this command focuses the current pane.

    Explicit --space, --tab, and --pane targets accept either a 1-based index or UUID.

    Example:
      sp focus-pane --space 1 --tab 2 --pane 3
      sp focus-pane --pane <pane-uuid>
    """

  static let closePaneDiscussion = """
    If you omit --space, --tab, and --pane inside Supaterm, this command closes the current pane.

    Explicit --space, --tab, and --pane targets accept either a 1-based index or UUID.

    Example:
      sp close-pane
      sp close-pane --space 1 --tab 2 --pane 3
      sp close-pane --pane <pane-uuid>
    """

  static let selectTabDiscussion = """
    If you omit --space and --tab inside Supaterm, this command selects the current tab.

    Explicit --space and --tab targets accept either a 1-based index or UUID.

    Example:
      sp select-tab --space 1 --tab 2
      sp select-tab --tab <tab-uuid>
    """

  static let closeTabDiscussion = """
    If you omit --space and --tab inside Supaterm, this command closes the current tab.

    Explicit --space and --tab targets accept either a 1-based index or UUID.

    Example:
      sp close-tab
      sp close-tab --space 1 --tab 2
      sp close-tab --tab <tab-uuid>
    """

  static let sendTextDiscussion = """
    If you omit --space, --tab, and --pane inside Supaterm, this command targets the current pane.

    Explicit --space, --tab, and --pane targets accept either a 1-based index or UUID.

    Example:
      sp send-text --text 'echo hello' --newline
      sp send-text --space 1 --tab 2 --pane 3 --text 'pwd'
      sp send-text --pane <pane-uuid> --text 'clear'
    """

  static let capturePaneDiscussion = """
    If you omit --space, --tab, and --pane inside Supaterm, this command captures the current pane.

    Explicit --space, --tab, and --pane targets accept either a 1-based index or UUID.

    Example:
      sp capture-pane
      sp capture-pane --scrollback --lines 200
      sp capture-pane --pane <pane-uuid> --json
    """

  static let resizePaneDiscussion = """
    If you omit --space, --tab, and --pane inside Supaterm, this command resizes the current pane.

    Explicit --space, --tab, and --pane targets accept either a 1-based index or UUID.

    Example:
      sp resize-pane right 10
      sp resize-pane down 5 --space 1 --tab 2 --pane 3
      sp resize-pane left 8 --pane <pane-uuid>
    """

  static let renameTabDiscussion = """
    If you omit --space and --tab inside Supaterm, this command renames the current tab.

    Explicit --space and --tab targets accept either a 1-based index or UUID.

    Example:
      sp rename-tab --title Build
      sp rename-tab --space 1 --tab 2 --title Logs
      sp rename-tab --tab <tab-uuid> --title ''
    """

  static let tmuxDiscussion = """
    `sp tmux` passes the remaining arguments to Supaterm's tmux compatibility layer.

    Connection options must come before the tmux command.

    Example:
      sp tmux list-panes
      sp tmux split-window -h -P
      sp tmux --instance work-mac display-message -p '#{session_name}:#{window_index}.#{pane_index}'
    """

  static let claudeTeamsDiscussion = """
    Launch the external Claude CLI with Supaterm's tmux compatibility layer enabled.

    Connection options must come before Claude arguments.

    Example:
      sp claude-teams
      sp claude-teams --resume
      sp claude-teams --instance work-mac --help
    """

  static let agentHookDiscussion = """
    Reads one agent hook event JSON object from stdin and forwards it to Supaterm.

    Install Claude or Codex hooks from Supaterm Settings > Coding Agents or with `sp install-agent-hooks`.

    Example:
      sp install-agent-hooks claude
      printf '{"hook_event_name":"Notification","message":"Claude needs your attention"}' | sp agent-hook --agent claude
      \(SupatermClaudeHookSettings.command)
    """

  static let installAgentHooksDiscussion = """
    Install Supaterm's hook bridge into the selected agent's user configuration.

    Example:
      sp install-agent-hooks claude
      sp install-agent-hooks codex
    """

  static let installAgentHooksClaudeDiscussion = """
    Installs Supaterm hooks into ~/.claude/settings.json.

    Example:
      sp install-agent-hooks claude
    """

  static let installAgentHooksCodexDiscussion = """
    Enables Codex hooks and installs Supaterm hooks into ~/.codex/hooks.json.

    Example:
      sp install-agent-hooks codex
    """

  static let developmentDiscussion = """
    These commands require the connected Supaterm instance to report a development build.

    Example:
      sp development claude session-start
      sp development claude pre-tool-use
      sp development claude notification
    """

  static let developmentClaudeDiscussion = """
    Run these commands inside the Supaterm pane you want to verify.

    These commands require the connected Supaterm instance to report a development build.

    Verification flow:
      sp development claude session-start
      sp development claude pre-tool-use
      sp development claude notification
      sp development claude stop
      sp development claude session-end

    Example:
      sp development claude session-start
      sp development claude notification
    """

  static let developmentClaudeSessionStartDiscussion = """
    Example:
      sp development claude session-start
    """

  static let developmentClaudePreToolUseDiscussion = """
    Example:
      sp development claude pre-tool-use
    """

  static let developmentClaudeNotificationDiscussion = """
    Example:
      sp development claude notification
    """

  static let developmentClaudeUserPromptSubmitDiscussion = """
    Example:
      sp development claude user-prompt-submit
    """

  static let developmentClaudeStopDiscussion = """
    Example:
      sp development claude stop
    """

  static let developmentClaudeSessionEndDiscussion = """
    Example:
      sp development claude session-end
    """
}

enum SPSocketOption: ExpressibleByArgument {
  case environment
  case explicit(String)

  init?(argument: String) {
    self = .explicit(argument)
  }

  var defaultValueDescription: String {
    switch self {
    case .environment:
      return SPHelp.socketDefaultValueDescription
    case .explicit(let path):
      return path
    }
  }

  var explicitPath: String? {
    switch self {
    case .environment:
      return nil
    case .explicit(let path):
      return path
    }
  }
}

struct SPConnectionOptions: ParsableArguments {
  @Option(
    name: .long,
    help: ArgumentHelp("Override the Unix socket path.", valueName: "socket")
  )
  var socket: SPSocketOption = .environment

  @Option(name: .long, help: "Target a reachable Supaterm instance by name or endpoint ID.")
  var instance: String?

  var explicitSocketPath: String? {
    socket.explicitPath
  }
}
