import AppKit
import Clocks
import ComposableArchitecture
import SupatermSupport
import SupatermTerminalCore
import SupatermUpdateFeature
import Testing

@testable import SupatermCLIShared
@testable import supaterm

func makeWindow() -> NSWindow {
  NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 1_440, height: 900),
    styleMask: [.titled, .closable, .miniaturizable, .resizable],
    backing: .buffered,
    defer: false
  )
}

func flushEffects() async {
  for _ in 0..<5 {
    await Task.yield()
  }
}

func waitForUpdateMenuActions(
  _ recorder: UpdateMenuActionRecorder,
  count: Int,
  timeout: Duration = .seconds(1)
) async -> [UpdateUserAction] {
  let clock = ContinuousClock()
  let deadline = clock.now.advanced(by: timeout)
  while clock.now < deadline {
    let actions = await recorder.actions()
    if actions.count >= count {
      return actions
    }
    await Task.yield()
  }
  return await recorder.actions()
}

func advanceClock(
  _ clock: TestClock<Duration>,
  by duration: Duration = .seconds(1)
) async {
  await flushEffects()
  await clock.advance(by: duration)
  await flushEffects()
}

func codexHook(
  _ json: String,
  transcriptPath: URL,
  context: SupatermCLIContext? = nil
) throws -> SupatermAgentHookRequest {
  try CodexHookFixtures.request(
    CodexHookFixtures.replacingTranscriptPath(in: json, with: transcriptPath.path),
    context: context
  )
}

func codexHookRequest(
  sessionID: String,
  hookEventName: SupatermAgentHookEventName,
  context: SupatermCLIContext? = nil,
  lastAssistantMessage: String? = nil
) -> SupatermAgentHookRequest {
  .init(
    agent: .codex,
    context: context,
    event: .init(
      cwd: CodexHookFixtures.cwd,
      hookEventName: hookEventName,
      lastAssistantMessage: lastAssistantMessage,
      sessionID: sessionID
    )
  )
}

func makeClaudeHookHarness<C: Clock<Duration>>(
  agentRunningTimeout: Duration = .seconds(15),
  transcriptPollInterval: Duration = .seconds(1),
  clock: C = ContinuousClock(),
  windowActivity: WindowActivityState = .init(isKeyWindow: true, isVisible: true)
) throws -> ClaudeHookHarness {
  initializeGhosttyForTests()

  let registry = TerminalWindowRegistry()
  let commandExecutor = makeCommandExecutor(
    registry: registry,
    agentRunningTimeout: agentRunningTimeout,
    transcriptPollInterval: transcriptPollInterval,
    clock: clock
  )
  let host = TerminalHostState()
  host.windowActivity = windowActivity
  let store = Store(initialState: AppFeature.State()) {
    AppFeature()
  }
  let windowControllerID = UUID()

  registry.register(
    keyboardShortcutForAction: { _ in nil },
    windowControllerID: windowControllerID,
    store: store,
    terminal: host,
    requestConfirmedWindowClose: {}
  )
  let window = makeWindow()
  registry.updateWindow(window, for: windowControllerID)
  host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

  let surfaceID = try #require(host.selectedSurfaceView?.id)
  let tabID = try #require(host.selectedTabID)
  return .init(
    commandExecutor: commandExecutor,
    context: .init(surfaceID: surfaceID, tabID: tabID.rawValue),
    host: host,
    registry: registry,
    store: store,
    tabID: tabID,
    window: window,
    windowControllerID: windowControllerID
  )
}

struct ClaudeHookHarness {
  let commandExecutor: TerminalCommandExecutor
  let context: SupatermCLIContext
  let host: TerminalHostState
  let registry: TerminalWindowRegistry
  let store: StoreOf<AppFeature>
  let tabID: TerminalTabID
  let window: NSWindow
  let windowControllerID: UUID
}

func makeCommandExecutor(registry: TerminalWindowRegistry) -> TerminalCommandExecutor {
  let commandExecutor = TerminalCommandExecutor(registry: registry)
  registry.commandExecutor = commandExecutor
  return commandExecutor
}

func makeCommandExecutor<C: Clock<Duration>>(
  registry: TerminalWindowRegistry,
  agentRunningTimeout: Duration,
  transcriptPollInterval: Duration,
  clock: C
) -> TerminalCommandExecutor {
  let commandExecutor = TerminalCommandExecutor(
    registry: registry,
    agentRunningTimeout: agentRunningTimeout,
    transcriptPollInterval: transcriptPollInterval,
    clock: clock
  )
  registry.commandExecutor = commandExecutor
  return commandExecutor
}

actor UpdateMenuActionRecorder {
  private var recordedActions: [UpdateUserAction] = []

  func actions() -> [UpdateUserAction] {
    recordedActions
  }

  func record(_ action: UpdateUserAction) {
    recordedActions.append(action)
  }
}
