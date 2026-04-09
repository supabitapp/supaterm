import ArgumentParser
import Testing

@testable import SPCLI

struct SPHelpTests {
  @Test
  func rootHelpListsEnvironmentVariablesAndExamples() {
    let help = SP.helpMessage(for: SP.self, columns: 100)

    #expect(help.contains("Environment:"))
    #expect(help.contains("SUPATERM_CLI_PATH"))
    #expect(help.contains("SUPATERM_SOCKET_PATH"))
    #expect(help.contains("SUPATERM_SURFACE_ID"))
    #expect(help.contains("SUPATERM_TAB_ID"))
    #expect(help.contains("Example:"))
    #expect(help.contains("sp ls"))
    #expect(help.contains("sp tab new --focus -- ping 1.1.1.1"))
    #expect(help.contains("sp pane split down -- tail -f /tmp/server.log"))
    #expect(help.contains("sp diagnostic"))
    #expect(help.contains("sp instance ls"))
    #expect(!help.contains("install-agent-hooks"))
    #expect(!help.contains("development"))
  }

  @Test
  func everyCommandHelpShowsExamples() {
    let helps = [
      SP.helpMessage(for: SP.Tree.self, columns: 100),
      SP.helpMessage(for: SP.Onboard.self, columns: 100),
      SP.helpMessage(for: SP.Diagnostic.self, columns: 100),
      SP.helpMessage(for: SP.Instance.self, columns: 100),
      SP.helpMessage(for: SP.Instances.self, columns: 100),
      SP.helpMessage(for: SP.Space.self, columns: 100),
      SP.helpMessage(for: SP.SpaceNew.self, columns: 100),
      SP.helpMessage(for: SP.Tab.self, columns: 100),
      SP.helpMessage(for: SP.NewTab.self, columns: 100),
      SP.helpMessage(for: SP.Pane.self, columns: 100),
      SP.helpMessage(for: SP.NewPane.self, columns: 100),
      SP.helpMessage(for: SP.FocusPane.self, columns: 100),
      SP.helpMessage(for: SP.SelectTab.self, columns: 100),
      SP.helpMessage(for: SP.ClosePane.self, columns: 100),
      SP.helpMessage(for: SP.CloseTab.self, columns: 100),
      SP.helpMessage(for: SP.SendText.self, columns: 100),
      SP.helpMessage(for: SP.CapturePane.self, columns: 100),
      SP.helpMessage(for: SP.ResizePane.self, columns: 100),
      SP.helpMessage(for: SP.PaneLayout.self, columns: 100),
      SP.helpMessage(for: SP.RenameTab.self, columns: 100),
      SP.helpMessage(for: SP.Tmux.self, columns: 100),
      SP.helpMessage(for: SP.ClaudeTeams.self, columns: 100),
      SP.helpMessage(for: SP.Agent.self, columns: 100),
      SP.helpMessage(for: SP.ReceiveAgentHook.self, columns: 100),
      SP.helpMessage(for: SP.InstallAgentHook.self, columns: 100),
      SP.helpMessage(for: SP.InstallAgentHook.Claude.self, columns: 100),
      SP.helpMessage(for: SP.InstallAgentHook.Codex.self, columns: 100),
      SP.helpMessage(for: SP.Internal.self, columns: 100),
      SP.helpMessage(for: SP.GenerateSettingsSchema.self, columns: 100),
      SP.helpMessage(for: SP.AgentSettings.self, columns: 100),
      SP.helpMessage(for: SP.Development.self, columns: 100),
      SP.helpMessage(for: SP.Development.Claude.self, columns: 100),
      SP.helpMessage(for: SP.Development.Claude.SessionStart.self, columns: 100),
    ]

    for help in helps {
      #expect(help.contains("Example:"))
    }
  }

  @Test
  func paneSplitHelpShowsAmbientTargetingAndExamples() {
    let help = SP.helpMessage(for: SP.NewPane.self, columns: 100)

    #expect(help.contains("--socket <socket>"))
    #expect(help.contains("default: $SUPATERM_SOCKET_PATH"))
    #expect(help.contains("If you omit --in inside Supaterm"))
    #expect(help.contains("tab selector, a pane selector, or a UUID"))
    #expect(help.contains("SUPATERM_SURFACE_ID"))
    #expect(help.contains("SUPATERM_TAB_ID"))
    #expect(help.contains("sp pane split down -- htop"))
    #expect(help.contains("sp pane split --layout keep right"))
    #expect(help.contains("sp pane split --in 1/2 left"))
    #expect(help.contains("sp pane split --in <tab-uuid> left"))
  }

  @Test
  func newTabAndNotifyHelpMentionSelectorTargets() {
    let newTabHelp = SP.helpMessage(for: SP.NewTab.self, columns: 100)
    let notifyHelp = SP.helpMessage(for: SP.Notify.self, columns: 100)

    #expect(newTabHelp.contains("space selector or UUID"))
    #expect(newTabHelp.contains("sp tab new --in <space-uuid>"))
    #expect(notifyHelp.contains("space/tab/pane"))
    #expect(notifyHelp.contains("sp pane notify <pane-uuid>"))
  }

  @Test
  func claudeHookHelpMentionsSettingsInstallation() {
    let help = SP.helpMessage(for: SP.ReceiveAgentHook.self, columns: 100)

    #expect(help.contains("Settings > Coding Agents"))
    #expect(help.contains("sp agent install-hook"))
    #expect(help.contains("sp agent remove-hook"))
    #expect(help.contains("receive-agent-hook --agent claude"))
  }

  @Test
  func onboardHelpMentionsInteractiveAgentSetup() {
    let help = SP.helpMessage(for: SP.Onboard.self, columns: 100)

    #expect(help.contains("coding-agent integrations"))
    #expect(help.contains("sp onboard --force"))
    #expect(help.contains("sp onboard --plain"))
  }

  @Test
  func installAgentHooksHelpShowsExamples() {
    let help = SP.helpMessage(for: SP.InstallAgentHook.self, columns: 100)

    #expect(help.contains("sp agent install-hook claude"))
    #expect(help.contains("sp agent install-hook codex"))
  }

  @Test
  func removeAgentHooksHelpShowsExamples() {
    let help = SP.helpMessage(for: SP.RemoveAgentHook.self, columns: 100)

    #expect(help.contains("sp agent remove-hook claude"))
    #expect(help.contains("sp agent remove-hook codex"))
  }

  @Test
  func developmentClaudeHelpShowsRuntimeGateAndVerificationFlow() {
    let help = SP.helpMessage(for: SP.Development.Claude.self, columns: 100)

    #expect(help.contains("development build"))
    #expect(help.contains("Run these commands inside the Supaterm pane"))
    #expect(help.contains("sp internal dev claude session-start"))
    #expect(help.contains("sp internal dev claude notification"))
    #expect(help.contains("sp internal dev claude session-end"))
  }

  @Test
  func internalHelpShowsSettingsSchemaExample() {
    let help = SP.helpMessage(for: SP.Internal.self, columns: 100)
    let schemaHelp = SP.helpMessage(for: SP.GenerateSettingsSchema.self, columns: 100)
    let customSchemaHelp = SP.helpMessage(for: SP.GenerateCustomCommandsSchema.self, columns: 100)

    #expect(help.contains("sp internal generate-settings-schema"))
    #expect(schemaHelp.contains("sp internal generate-settings-schema"))
    #expect(help.contains("sp internal generate-custom-commands-schema"))
    #expect(customSchemaHelp.contains("sp internal generate-custom-commands-schema"))
  }

  @Test
  func tmuxAndClaudeTeamsHelpShowPassThroughExamples() {
    let tmuxHelp = SP.helpMessage(for: SP.Tmux.self, columns: 100)
    let teammateHelp = SP.helpMessage(for: SP.ClaudeTeams.self, columns: 100)

    #expect(tmuxHelp.contains("sp tmux split-window -h -P"))
    #expect(tmuxHelp.contains("--instance work-mac"))
    #expect(teammateHelp.contains("sp internal claude-teams"))
    #expect(teammateHelp.contains("Example:"))
  }
}
