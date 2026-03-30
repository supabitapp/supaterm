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
    #expect(help.contains("sp tree"))
    #expect(help.contains("sp new-pane --space 1 --tab 1 down"))
    #expect(help.contains("install-agent-hooks"))
    #expect(help.contains("development"))
  }

  @Test
  func everyCommandHelpShowsExamples() {
    let helps = [
      SP.helpMessage(for: SP.Tree.self, columns: 100),
      SP.helpMessage(for: SP.Onboard.self, columns: 100),
      SP.helpMessage(for: SP.Debug.self, columns: 100),
      SP.helpMessage(for: SP.Instances.self, columns: 100),
      SP.helpMessage(for: SP.NewTab.self, columns: 100),
      SP.helpMessage(for: SP.NewPane.self, columns: 100),
      SP.helpMessage(for: SP.AgentHook.self, columns: 100),
      SP.helpMessage(for: SP.InstallAgentHooks.self, columns: 100),
      SP.helpMessage(for: SP.InstallAgentHooks.Claude.self, columns: 100),
      SP.helpMessage(for: SP.InstallAgentHooks.Codex.self, columns: 100),
      SP.helpMessage(for: SP.Development.self, columns: 100),
      SP.helpMessage(for: SP.Development.Claude.self, columns: 100),
      SP.helpMessage(for: SP.Development.Claude.SessionStart.self, columns: 100),
    ]

    for help in helps {
      #expect(help.contains("Example:"))
    }
  }

  @Test
  func newPaneHelpShowsSocketEnvironmentDefaultAmbientPaneTargetingAndExamples() {
    let help = SP.helpMessage(for: SP.NewPane.self, columns: 100)

    #expect(help.contains("--socket <socket>"))
    #expect(help.contains("default: $SUPATERM_SOCKET_PATH"))
    #expect(help.contains("If you omit --space and --tab inside Supaterm"))
    #expect(help.contains("1-based index or UUID"))
    #expect(help.contains("SUPATERM_SURFACE_ID"))
    #expect(help.contains("SUPATERM_TAB_ID"))
    #expect(help.contains("Example:"))
    #expect(help.contains("--no-equalize"))
    #expect(help.contains("sp new-pane down htop"))
    #expect(help.contains("--tab <tab>"))
    #expect(help.contains("sp new-pane --tab <tab-uuid> left"))
  }

  @Test
  func newTabAndNotifyHelpMentionUUIDTargets() {
    let newTabHelp = SP.helpMessage(for: SP.NewTab.self, columns: 100)
    let notifyHelp = SP.helpMessage(for: SP.Notify.self, columns: 100)

    #expect(newTabHelp.contains("1-based index or UUID"))
    #expect(newTabHelp.contains("sp new-tab --space <space-uuid>"))
    #expect(notifyHelp.contains("1-based index or UUID"))
    #expect(notifyHelp.contains("sp notify --pane <pane-uuid>"))
  }

  @Test
  func claudeHookHelpMentionsSettingsInstallation() {
    let help = SP.helpMessage(for: SP.AgentHook.self, columns: 100)

    #expect(help.contains("Settings > Coding Agents"))
    #expect(help.contains("sp install-agent-hooks"))
  }

  @Test
  func installAgentHooksHelpShowsExamples() {
    let help = SP.helpMessage(for: SP.InstallAgentHooks.self, columns: 100)

    #expect(help.contains("sp install-agent-hooks claude"))
    #expect(help.contains("sp install-agent-hooks codex"))
  }

  @Test
  func developmentClaudeHelpShowsRuntimeGateAndVerificationFlow() {
    let help = SP.helpMessage(for: SP.Development.Claude.self, columns: 100)

    #expect(help.contains("development build"))
    #expect(help.contains("Run these commands inside the Supaterm pane"))
    #expect(help.contains("sp development claude session-start"))
    #expect(help.contains("sp development claude notification"))
    #expect(help.contains("sp development claude session-end"))
  }
}
