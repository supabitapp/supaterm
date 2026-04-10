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
      sp ls
      sp tab new --focus -- ping 1.1.1.1
      sp pane split down -- tail -f /tmp/server.log
      sp diagnostic
      sp instance ls
    """

  static let treeDiscussion = """
    `sp ls --json` includes UUIDs for spaces, tabs, and panes.

    Example:
      sp ls
      sp ls --json
      sp ls --plain
      sp ls --instance work-mac
    """

  static let onboardDiscussion = """
    Interactive human sessions can offer to configure Supaterm coding-agent hooks and agent skills before showing shortcuts.

    Example:
      sp onboard
      sp onboard --force
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

    `--in` accepts a tab selector, a pane selector, or a UUID.

    Example:
      sp pane split right
      sp pane split down -- htop
      sp pane split down --shell $'echo 1\necho 2'
      sp pane split --layout keep right
      sp pane split --in 1/2 left
      sp pane split --in <tab-uuid> left
      sp pane split --in 1/2/3 down -- tail -f /tmp/server.log
    """

  static let newTabDiscussion = """
    If you omit --in inside Supaterm, this command creates the tab in the current space.

    That ambient pane target comes from \(SupatermCLIEnvironment.surfaceIDKey) and \(SupatermCLIEnvironment.tabIDKey).

    `--in` accepts a space selector or UUID.

    Example:
      sp tab new -- ping 1.1.1.1
      sp tab new --shell $'echo 1\necho 2'
      sp tab new --focus -- ping 1.1.1.1
      sp tab new --in 1 --cwd ~/tmp -- ping 1.1.1.1
      sp tab new --in <space-uuid> --cwd ~/tmp -- ping 1.1.1.1
    """

  static let notifyDiscussion = """
    If you omit the pane target inside Supaterm, this command targets the current pane.

    Pane targets accept either a `space/tab/pane` selector or a UUID.

    Example:
      sp pane notify --body "All tests passed"
      sp pane notify 1/2/3 --body "Deploy complete"
      sp pane notify <pane-uuid> --body "Deploy complete"
    """

  static let focusPaneDiscussion = """
    If you omit the pane target inside Supaterm, this command focuses the current pane.

    Pane targets accept either a `space/tab/pane` selector or a UUID.

    Example:
      sp pane focus 1/2/3
      sp pane focus <pane-uuid>
    """

  static let closePaneDiscussion = """
    If you omit the pane target inside Supaterm, this command closes the current pane.

    Pane targets accept either a `space/tab/pane` selector or a UUID.

    Example:
      sp pane close
      sp pane close 1/2/3
      sp pane close <pane-uuid>
    """

  static let selectTabDiscussion = """
    If you omit the tab target inside Supaterm, this command focuses the current tab.

    Tab targets accept either a `space/tab` selector or a UUID.

    Example:
      sp tab focus 1/2
      sp tab focus <tab-uuid>
    """

  static let closeTabDiscussion = """
    If you omit the tab target inside Supaterm, this command closes the current tab.

    Tab targets accept either a `space/tab` selector or a UUID.

    Example:
      sp tab close
      sp tab close 1/2
      sp tab close <tab-uuid>
    """

  static let sendTextDiscussion = """
    If you omit the pane target inside Supaterm, this command targets the current pane.

    Pane targets accept either a `space/tab/pane` selector or a UUID.

    Example:
      sp pane send --newline 'echo hello'
      sp pane send 1/2/3 'pwd'
      sp pane send <pane-uuid> 'clear'
      printf 'pwd' | sp pane send
    """

  static let capturePaneDiscussion = """
    If you omit the pane target inside Supaterm, this command captures the current pane.

    Pane targets accept either a `space/tab/pane` selector or a UUID.

    Example:
      sp pane capture
      sp pane capture --scope scrollback --lines 200
      sp pane capture <pane-uuid> --json
    """

  static let resizePaneDiscussion = """
    If you omit the pane target inside Supaterm, this command resizes the current pane.

    Pane targets accept either a `space/tab/pane` selector or a UUID.

    Example:
      sp pane resize right 10
      sp pane resize down 5 1/2/3
      sp pane resize left 8 <pane-uuid>
    """

  static let renameTabDiscussion = """
    If you omit the tab target inside Supaterm, this command renames the current tab.

    Tab targets accept either a `space/tab` selector or a UUID.

    Example:
      sp tab rename Build
      sp tab rename Logs 1/2
      sp tab rename '' <tab-uuid>
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
      sp internal claude-teams
      sp internal claude-teams --resume
      sp internal claude-teams --instance work-mac --help
    """

  static let receiveAgentHookDiscussion = """
    Reads one agent hook event JSON object from stdin and forwards it to Supaterm.

    Manage coding-agent integrations from Supaterm Settings > Coding Agents. Use `sp agent install-hook` and `sp agent remove-hook` for Claude or Codex.

    Example:
      sp agent install-hook claude
      sp agent remove-hook claude
      printf '{"hook_event_name":"Notification","message":"Claude needs your attention"}' | sp agent receive-agent-hook --agent claude
      \(SupatermClaudeHookSettings.command)
    """

  static let installAgentHookDiscussion = """
    Install Supaterm's hook bridge into the selected agent's user configuration.

    Example:
      sp agent install-hook claude
      sp agent install-hook codex
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

  static let generateSettingsSchemaDiscussion = """
    Example:
      sp internal generate-settings-schema
    """

  static let developmentDiscussion = """
    These commands require the connected Supaterm instance to report a development build.

    Example:
      sp internal dev claude session-start
      sp internal dev claude pre-tool-use
      sp internal dev claude notification
    """

  static let developmentClaudeDiscussion = """
    Run these commands inside the Supaterm pane you want to verify.

    These commands require the connected Supaterm instance to report a development build.

    Verification flow:
      sp internal dev claude session-start
      sp internal dev claude pre-tool-use
      sp internal dev claude notification
      sp internal dev claude stop
      sp internal dev claude session-end

    Example:
      sp internal dev claude session-start
      sp internal dev claude notification
    """

  static let developmentClaudeSessionStartDiscussion = """
    Example:
      sp internal dev claude session-start
    """

  static let developmentClaudePreToolUseDiscussion = """
    Example:
      sp internal dev claude pre-tool-use
    """

  static let developmentClaudeNotificationDiscussion = """
    Example:
      sp internal dev claude notification
    """

  static let developmentClaudeUserPromptSubmitDiscussion = """
    Example:
      sp internal dev claude user-prompt-submit
    """

  static let developmentClaudeStopDiscussion = """
    Example:
      sp internal dev claude stop
    """

  static let developmentClaudeSessionEndDiscussion = """
    Example:
      sp internal dev claude session-end
    """

  static let instanceDiscussion = """
    Example:
      sp instance ls
      sp instance ls --plain
    """

  static let spaceDiscussion = """
    Example:
      sp space new --focus
      sp space focus 1
      sp space rename Work 1
      sp space next
    """

  static let tabDiscussion = """
    Example:
      sp tab new --focus -- ping 1.1.1.1
      sp tab focus 1/2
      sp tab rename Logs 1/2
      sp tab next 1
    """

  static let paneDiscussion = """
    Example:
      sp pane split down -- htop
      sp pane focus 1/2/3
      sp pane send --newline 'echo hello'
      sp pane layout equalize 1/2
    """

  static let spaceNewDiscussion = """
    Example:
      sp space new
      sp space new --focus
    """

  static let spaceFocusDiscussion = """
    Example:
      sp space focus
      sp space focus 1
      sp space focus <space-uuid>
    """

  static let spaceCloseDiscussion = """
    Example:
      sp space close
      sp space close 1
      sp space close <space-uuid>
    """

  static let spaceRenameDiscussion = """
    Example:
      sp space rename Work
      sp space rename Logs 1
      sp space rename Build <space-uuid>
    """

  static let spaceNavigationDiscussion = """
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
      sp agent install-hook claude
      sp agent install-hook codex
    """

  static let internalDiscussion = """
    Example:
      sp internal ping
      sp internal generate-settings-schema
      sp internal agent-settings claude
      sp internal dev claude session-start
    """
}
