import AppKit
import Clocks
import ComposableArchitecture
import SupatermSupport
import SupatermTerminalCore
import SupatermUpdateFeature
import Testing

@testable import SupatermCLIShared
@testable import supaterm

private struct TestAgentTarget {
  let scope: TerminalAgentEvent.Scope
  let context: SupatermCLIContext
  let hoverMessages: [String]
}

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

@MainActor
func waitUntil(
  timeout: Duration = .seconds(1),
  _ condition: () -> Bool
) async -> Bool {
  let clock = ContinuousClock()
  let deadline = clock.now.advanced(by: timeout)
  while clock.now < deadline {
    if condition() {
      return true
    }
    try? await clock.sleep(for: .milliseconds(5))
  }
  return condition()
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

func agentHookRequest(
  agent: SupatermAgentKind,
  sessionID: String,
  hookEventName: SupatermAgentHookEventName,
  context: SupatermCLIContext? = nil,
  lastAssistantMessage: String? = nil
) -> SupatermAgentHookRequest {
  SupatermAgentHookRequest(
    agent: agent,
    context: context,
    event: SupatermAgentHookEvent(
      cwd: CodexHookFixtures.cwd,
      hookEventName: hookEventName,
      lastAssistantMessage: lastAssistantMessage,
      sessionID: sessionID
    )
  )
}

func makeClaudeHookHarness<C: Clock<Duration>>(
  agentRunningTimeout: Duration = .seconds(15),
  transcriptEventDelay: Duration = .zero,
  clock: C = ContinuousClock(),
  windowActivity: WindowActivityState = WindowActivityState(isKeyWindow: true, isVisible: true)
) throws -> ClaudeHookHarness {
  initializeGhosttyForTests()

  let registry = TerminalWindowRegistry()
  let commandExecutor = makeCommandExecutor(
    registry: registry,
    agentRunningTimeout: agentRunningTimeout,
    transcriptEventDelay: transcriptEventDelay,
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
  host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

  let surfaceID = try #require(host.selectedSurfaceView?.id)
  let tabID = try #require(host.selectedTabID)
  let harness = ClaudeHookHarness(
    commandExecutor: commandExecutor,
    context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue),
    host: host,
    registry: registry,
    store: store,
    tabID: tabID,
    window: window,
    windowControllerID: windowControllerID
  )
  registry.updateWindow(harness.window, for: windowControllerID)
  return harness
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
  transcriptEventDelay: Duration,
  clock: C
) -> TerminalCommandExecutor {
  let commandExecutor = TerminalCommandExecutor(
    registry: registry,
    agentRunningTimeout: agentRunningTimeout,
    transcriptEventDelay: transcriptEventDelay,
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

extension TerminalHostState {
  @discardableResult
  func startTestAgentSession(
    agent: SupatermAgentKind,
    for surfaceID: UUID,
    sessionID: String?,
    processID: Int32?
  ) -> Bool {
    guard let sessionID, let tabID = tabID(containing: surfaceID) else { return false }
    return applyAgentEvent(
      TerminalAgentEvent(
        scope: TerminalAgentEvent.Scope(agent: agent, sessionID: sessionID),
        context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue),
        processID: processID,
        action: .sessionResumed(transcriptPath: nil)
      )
    ).changed
  }

  @discardableResult
  func applyTestAgentActivity(
    _ activity: AgentActivity,
    for surfaceID: UUID,
    sessionID: String?,
    processID: Int32?
  ) -> Bool {
    guard let sessionID, let tabID = tabID(containing: surfaceID) else { return false }
    if !hasAgentSession(agent: activity.kind, sessionID: sessionID) {
      _ = startTestAgentSession(
        agent: activity.kind,
        for: surfaceID,
        sessionID: sessionID,
        processID: processID
      )
    }
    let action: TerminalAgentEvent.Action =
      switch activity.phase {
      case .idle: .turnCompleted(message: nil)
      case .needsInput: .attentionRequested(requestID: nil, message: activity.detail)
      case .running: .turnRunning(detail: activity.detail)
      }
    return applyAgentEvent(
      TerminalAgentEvent(
        scope: TerminalAgentEvent.Scope(agent: activity.kind, sessionID: sessionID),
        context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue),
        processID: processID,
        action: action
      )
    ).changed
  }

  @discardableResult
  func makeTestAgentSessionActionable(
    agent: SupatermAgentKind,
    for surfaceID: UUID,
    sessionID: String?,
    processID: Int32?
  ) -> Bool {
    guard let sessionID, let tabID = tabID(containing: surfaceID) else { return false }
    if !hasAgentSession(agent: agent, sessionID: sessionID) {
      _ = startTestAgentSession(
        agent: agent,
        for: surfaceID,
        sessionID: sessionID,
        processID: processID
      )
    }
    return applyAgentEvent(
      TerminalAgentEvent(
        scope: TerminalAgentEvent.Scope(agent: agent, sessionID: sessionID),
        context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue),
        processID: processID,
        action: .turnCompleted(message: nil)
      )
    ).changed
  }

  @discardableResult
  func setTestAgentHoverMessages(
    _ messages: [String],
    replacing: Bool,
    for surfaceID: UUID
  ) -> Bool {
    guard let target = testAgentTarget(for: surfaceID) else { return false }
    var nextMessages = replacing ? [] : target.hoverMessages
    for message in messages.compactMap(normalizedTerminalAgentDetail) where nextMessages.last != message {
      nextMessages.append(message)
    }
    return applyAgentEvent(
      TerminalAgentEvent(
        scope: target.scope,
        context: target.context,
        action: .hoverMessagesUpdated(nextMessages)
      )
    ).changed
  }

  @discardableResult
  func setTestAgentProgressRows(
    progressRows: [PaneAgentProgressRow],
    for surfaceID: UUID
  ) -> Bool {
    guard let target = testAgentTarget(for: surfaceID) else { return false }
    return applyAgentEvent(
      TerminalAgentEvent(
        scope: target.scope,
        context: target.context,
        action: .progressUpdated(progressRows, source: .transcript)
      )
    ).changed
  }

  private func testAgentTarget(for surfaceID: UUID) -> TestAgentTarget? {
    guard let tabID = tabID(containing: surfaceID),
      let snapshot = agentStateStore.snapshots(for: surfaceID)
        .filter(\.isForeground)
        .max(by: { $0.revision < $1.revision })
    else {
      return nil
    }
    return TestAgentTarget(
      scope: TerminalAgentEvent.Scope(agent: snapshot.agent, sessionID: snapshot.sessionID),
      context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue),
      hoverMessages: snapshot.hoverMessages
    )
  }
}
