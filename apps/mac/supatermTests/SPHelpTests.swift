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
    #expect(help.contains("SUPATERM_STATE_HOME"))
    #expect(help.contains("SUPATERM_SURFACE_ID"))
    #expect(help.contains("SUPATERM_TAB_ID"))
    #expect(help.contains("Example:"))
    #expect(help.contains("sp ls"))
    #expect(help.contains("sp group new Work --color blue"))
    #expect(help.contains("sp tab new --focus -- ping 1.1.1.1"))
    #expect(help.contains("sp pane split down -- tail -f /tmp/server.log"))
    #expect(help.contains("sp skills"))
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
      SP.helpMessage(for: SP.Config.self, columns: 100),
      SP.helpMessage(for: SP.ValidateConfig.self, columns: 100),
      SP.helpMessage(for: SP.Space.self, columns: 100),
      SP.helpMessage(for: SP.SpaceNew.self, columns: 100),
      SP.helpMessage(for: SP.SpaceDestroy.self, columns: 100),
      SP.helpMessage(for: SP.Tab.self, columns: 100),
      SP.helpMessage(for: SP.NewTab.self, columns: 100),
      SP.helpMessage(for: SP.MoveTab.self, columns: 100),
      SP.helpMessage(for: SP.Group.self, columns: 100),
      SP.helpMessage(for: SP.GroupNew.self, columns: 100),
      SP.helpMessage(for: SP.GroupRename.self, columns: 100),
      SP.helpMessage(for: SP.GroupColor.self, columns: 100),
      SP.helpMessage(for: SP.GroupPin.self, columns: 100),
      SP.helpMessage(for: SP.GroupUnpin.self, columns: 100),
      SP.helpMessage(for: SP.GroupCollapse.self, columns: 100),
      SP.helpMessage(for: SP.GroupExpand.self, columns: 100),
      SP.helpMessage(for: SP.GroupMove.self, columns: 100),
      SP.helpMessage(for: SP.GroupUngroup.self, columns: 100),
      SP.helpMessage(for: SP.GroupClose.self, columns: 100),
      SP.helpMessage(for: SP.Pane.self, columns: 100),
      SP.helpMessage(for: SP.NewPane.self, columns: 100),
      SP.helpMessage(for: SP.FocusPane.self, columns: 100),
      SP.helpMessage(for: SP.SelectTab.self, columns: 100),
      SP.helpMessage(for: SP.PinTab.self, columns: 100),
      SP.helpMessage(for: SP.UnpinTab.self, columns: 100),
      SP.helpMessage(for: SP.ClosePane.self, columns: 100),
      SP.helpMessage(for: SP.CloseTab.self, columns: 100),
      SP.helpMessage(for: SP.SendText.self, columns: 100),
      SP.helpMessage(for: SP.CapturePane.self, columns: 100),
      SP.helpMessage(for: SP.PaneHealth.self, columns: 100),
      SP.helpMessage(for: SP.PaneWaitReady.self, columns: 100),
      SP.helpMessage(for: SP.ResizePane.self, columns: 100),
      SP.helpMessage(for: SP.PaneLayout.self, columns: 100),
      SP.helpMessage(for: SP.RenameTab.self, columns: 100),
      SP.helpMessage(for: SP.Run.self, columns: 100),
      SP.helpMessage(for: SP.Tmux.self, columns: 100),
      SP.helpMessage(for: SP.Skills.self, columns: 100),
      SP.helpMessage(for: SP.ListSkills.self, columns: 100),
      SP.helpMessage(for: SP.GetSkill.self, columns: 100),
      SP.helpMessage(for: SP.InstallSkill.self, columns: 100),
      SP.helpMessage(for: SP.Agent.self, columns: 100),
      SP.helpMessage(for: SP.ReceiveAgentHook.self, columns: 100),
      SP.helpMessage(for: SP.InstallAgentHooks.self, columns: 100),
      SP.helpMessage(for: SP.InstallAgentHook.self, columns: 100),
      SP.helpMessage(for: SP.InstallAgentHook.Claude.self, columns: 100),
      SP.helpMessage(for: SP.InstallAgentHook.Codex.self, columns: 100),
      SP.helpMessage(for: SP.Internal.self, columns: 100),
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
    #expect(help.contains("sp pane split right --cwd ~/tmp"))
    #expect(help.contains("sp pane split --layout keep right"))
    #expect(help.contains("sp pane split --in 1/2 left"))
    #expect(help.contains("sp pane split --in <tab-uuid> left"))
  }

  @Test
  func paneHealthHelpShowsReadinessExamples() {
    let paneHelp = SP.helpMessage(for: SP.Pane.self, columns: 100)
    let healthHelp = SP.helpMessage(for: SP.PaneHealth.self, columns: 100)
    let waitHelp = SP.helpMessage(for: SP.PaneWaitReady.self, columns: 100)

    #expect(paneHelp.contains("sp pane health <pane-uuid> --json"))
    #expect(paneHelp.contains("sp pane wait-ready <pane-uuid> --timeout 5"))
    #expect(healthHelp.contains("sp pane health <pane-uuid> --json"))
    #expect(waitHelp.contains("sp pane wait-ready <pane-uuid> --timeout 5"))
  }

  @Test
  func paneSendHelpShowsPasteAwareSubmission() {
    let help = SP.helpMessage(for: SP.SendText.self, columns: 100)

    #expect(help.contains("sp pane send --submit <pane-uuid> - < prompt.md"))
  }

  @Test
  func renameTabHelpShowsOnlyValidExamples() {
    let help = SP.helpMessage(for: SP.RenameTab.self, columns: 100)

    #expect(help.contains("sp tab rename Deploy <tab-uuid>"))
    #expect(!help.contains("sp tab rename ''"))
  }

  @Test
  func newTabAndNotifyHelpMentionSelectorTargets() {
    let newTabHelp = SP.helpMessage(for: SP.NewTab.self, columns: 100)
    let notifyHelp = SP.helpMessage(for: SP.Notify.self, columns: 100)

    #expect(newTabHelp.contains("space selector or UUID"))
    #expect(newTabHelp.contains("Trailing arguments after `--` are treated as a terminal startup command."))
    #expect(newTabHelp.contains("`--script` runs shell script text as the terminal startup command."))
    #expect(newTabHelp.contains("sp tab new --script 'echo hi; pwd'"))
    #expect(newTabHelp.contains("sp tab new --group Build"))
    #expect(newTabHelp.contains("sp tab new --root"))
    #expect(newTabHelp.contains("sp tab new --in <space-uuid>"))
    #expect(notifyHelp.contains("space/tab/pane"))
    #expect(notifyHelp.contains("sp pane notify <pane-uuid>"))
  }

  @Test
  func groupAndMoveHelpLockPublicSyntax() {
    let groupHelp = SP.helpMessage(for: SP.Group.self, columns: 100)
    let newHelp = SP.helpMessage(for: SP.GroupNew.self, columns: 100)
    let moveHelp = SP.helpMessage(for: SP.GroupMove.self, columns: 100)
    let closeHelp = SP.helpMessage(for: SP.GroupClose.self, columns: 100)
    let tabMoveHelp = SP.helpMessage(for: SP.MoveTab.self, columns: 100)

    #expect(groupHelp.contains("sp group new Build"))
    #expect(groupHelp.contains("sp group rename Deploy Build"))
    #expect(groupHelp.contains("sp group color blue Deploy"))
    #expect(groupHelp.contains("sp group collapse Deploy"))
    #expect(groupHelp.contains("sp group ungroup Deploy"))
    #expect(newHelp.contains("sp group new Deploy --color blue"))
    #expect(newHelp.contains("sp group new Pinned --pin"))
    #expect(moveHelp.contains("sp group move Deploy --index 2"))
    #expect(closeHelp.contains("sp group close Build --yes"))
    #expect(tabMoveHelp.contains("sp tab move 1/2 --group <group-uuid> --index 1"))
    #expect(tabMoveHelp.contains("sp tab move <tab-uuid> --root --pin --index 1"))
    #expect(!groupHelp.contains("sp group delete"))
  }

  @Test
  func spaceHelpExamplesRequireNamesForSpaceCreation() {
    let spaceHelp = SP.helpMessage(for: SP.Space.self, columns: 100)
    let spaceNewHelp = SP.helpMessage(for: SP.SpaceNew.self, columns: 100)
    let spaceDestroyHelp = SP.helpMessage(for: SP.SpaceDestroy.self, columns: 100)

    #expect(spaceHelp.contains("sp space new --focus Work"))
    #expect(spaceHelp.contains("sp space destroy -y 1"))
    #expect(!spaceHelp.contains("sp space new --focus\n"))
    #expect(spaceNewHelp.contains("sp space new Work"))
    #expect(spaceNewHelp.contains("sp space new --focus Build"))
    #expect(!spaceNewHelp.contains("sp space new\n"))
    #expect(!spaceNewHelp.contains("sp space new --focus\n"))
    #expect(spaceDestroyHelp.contains("sp space destroy -y"))
    #expect(spaceDestroyHelp.contains("sp space destroy -y 1"))
    #expect(!spaceDestroyHelp.contains("sp space close"))
  }

  @Test
  func tabHelpShowsPinAndUnpinExamples() {
    let tabHelp = SP.helpMessage(for: SP.Tab.self, columns: 100)
    let pinHelp = SP.helpMessage(for: SP.PinTab.self, columns: 100)
    let unpinHelp = SP.helpMessage(for: SP.UnpinTab.self, columns: 100)

    #expect(tabHelp.contains("sp tab pin 1/2"))
    #expect(tabHelp.contains("sp tab unpin 1/2"))
    #expect(pinHelp.contains("sp tab pin"))
    #expect(pinHelp.contains("sp tab pin <tab-uuid>"))
    #expect(unpinHelp.contains("sp tab unpin"))
    #expect(unpinHelp.contains("sp tab unpin <tab-uuid>"))
  }

  @Test
  func claudeHookHelpMentionsSettingsInstallation() {
    let help = SP.helpMessage(for: SP.ReceiveAgentHook.self, columns: 100)

    #expect(help.contains("Settings > Coding Agents"))
    #expect(help.contains("sp skills install"))
    #expect(help.contains("sp agent install-hooks"))
    #expect(help.contains("sp agent install-hook"))
    #expect(help.contains("sp agent remove-hook"))
    #expect(help.contains("receive-agent-hook --agent claude"))
  }

  @Test
  func onboardHelpMentionsSetupCommands() {
    let help = SP.helpMessage(for: SP.Onboard.self, columns: 100)

    #expect(help.contains("coding-agent setup commands"))
    #expect(!help.contains("agent skills"))
    #expect(!help.contains("sp onboard --force"))
    #expect(help.contains("sp onboard --plain"))
  }

  @Test
  func skillsHelpShowsCatalogAndInstallExamples() {
    let skillsHelp = SP.helpMessage(for: SP.Skills.self, columns: 100)
    let listHelp = SP.helpMessage(for: SP.ListSkills.self, columns: 100)
    let getHelp = SP.helpMessage(for: SP.GetSkill.self, columns: 100)
    let pathHelp = SP.helpMessage(for: SP.PathSkill.self, columns: 100)
    let installHelp = SP.helpMessage(for: SP.InstallSkill.self, columns: 100)

    #expect(skillsHelp.contains("sp skills get coding-agents"))
    #expect(listHelp.contains("sp skills list --json"))
    #expect(getHelp.contains("sp skills get core --full"))
    #expect(!getHelp.contains("--json"))
    #expect(pathHelp.contains("sp skills path core"))
    #expect(installHelp.contains("sp skills install --json"))
  }

  @Test
  func installAgentHooksHelpShowsExamples() {
    let aggregateHelp = SP.helpMessage(for: SP.InstallAgentHooks.self, columns: 100)
    let help = SP.helpMessage(for: SP.InstallAgentHook.self, columns: 100)

    #expect(aggregateHelp.contains("sp agent install-hooks"))
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
  func configHelpShowsValidationExamples() {
    let help = SP.helpMessage(for: SP.Config.self, columns: 100)
    let validateHelp = SP.helpMessage(for: SP.ValidateConfig.self, columns: 100)

    #expect(help.contains("sp config validate"))
    #expect(help.contains("sp config get updates.channel"))
    #expect(help.contains("sp config set appearance.mode system"))
    #expect(help.contains("sp config reset privacy.analytics_enabled"))
    #expect(validateHelp.contains("sp config validate --path ./settings.toml"))
  }

  @Test
  func tmuxAndRunHelpShowPassThroughExamples() {
    let tmuxHelp = SP.helpMessage(for: SP.Tmux.self, columns: 100)
    let runHelp = SP.helpMessage(for: SP.Run.self, columns: 100)

    #expect(tmuxHelp.contains("sp tmux split-window -h -P"))
    #expect(tmuxHelp.contains("--instance work-mac"))
    #expect(runHelp.contains("sp run -- claude --resume"))
    #expect(runHelp.contains("Example:"))
  }

}
