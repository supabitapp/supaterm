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
}

func makeWindow() -> NSWindow {
  NSWindow(
    contentRect: NSRect(x: 0, y: 0, width: 1_440, height: 900),
    styleMask: [.titled, .closable, .miniaturizable, .resizable],
    backing: .buffered,
    defer: false
  )
}

func attachTerminalSurfaces(
  _ surfaces: [GhosttySurfaceView],
  to window: NSWindow,
  focusing firstResponder: GhosttySurfaceView
) {
  let container = NSView(frame: window.contentView?.bounds ?? .zero)
  for surface in surfaces {
    surface.frame = container.bounds
    container.addSubview(surface)
  }
  window.contentView = container
  window.makeFirstResponder(firstResponder)
}

func makeWindow(focusing surface: GhosttySurfaceView) -> NSWindow {
  let window = makeWindow()
  attachTerminalSurfaces([surface], to: window, focusing: surface)
  return window
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

func terminalSpaceSession(
  spaceID: TerminalSpaceID,
  tabCount: Int
) -> TerminalSpaceSession {
  let tabIDs = (0..<tabCount).map { _ in TerminalTabID() }
  return TerminalSpaceSession(
    spaceID: spaceID,
    selectedTabID: tabIDs.first,
    nodes: tabIDs.enumerated().map { index, tabID in
      TerminalTabNodeSession(
        item: .tab(tabID),
        parent: .root(isPinned: false),
        order: index
      )
    },
    groups: [],
    collapsedGroupIDs: [],
    tabs: tabIDs.map { tabID in
      TerminalTabSession(
        id: tabID,
        lockedTitle: nil,
        focusedPaneIndex: 0,
        root: .leaf(TerminalPaneLeafSession(workingDirectoryPath: nil))
      )
    }
  )
}

func agentHookRequest(
  agent: SupatermAgentKind,
  sessionID: String,
  hookEventName: SupatermAgentHookEventName,
  context: SupatermCLIContext? = nil,
  cwd: String = CodexHookFixtures.cwd,
  lastAssistantMessage: String? = nil,
  processID: Int32? = nil
) -> SupatermAgentHookRequest {
  SupatermAgentHookRequest(
    agent: agent,
    context: context,
    event: SupatermAgentHookEvent(
      cwd: cwd,
      hookEventName: hookEventName,
      lastAssistantMessage: lastAssistantMessage,
      sessionID: sessionID,
      transcriptPath: agent == .codex ? CodexHookFixtures.transcriptPath : nil
    ),
    processID: processID
  )
}

func agentDetectionObservation(
  agent: SupatermAgentKind = .codex,
  phase: AgentActivityPhase,
  processIdentity: TerminalAgentProcessIdentity,
  workingDirectoryPath: String? = nil,
  ruleID: String = "test",
  sequence: UInt64
) -> TerminalAgentDetectionObservation {
  TerminalAgentDetectionObservation(
    agent: AgentDetectionAgentIdentity(agent),
    phase: phase,
    processIdentity: processIdentity,
    workingDirectoryPath: workingDirectoryPath,
    ruleID: ruleID,
    generation: 1,
    sequence: sequence
  )
}

func makeClaudeHookHarness(
  windowActivity: WindowActivityState = WindowActivityState(isKeyWindow: true, isVisible: true)
) throws -> ClaudeHookHarness {
  initializeGhosttyForTests()

  let registry = TerminalWindowRegistry.test()
  let host = TerminalHostState.test()
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
  host.ensureInitialTab(focusing: false, startupCommand: nil)

  let surface = try #require(host.selectedSurfaceView)
  attachTerminalSurfaces([surface], to: window, focusing: surface)
  let surfaceID = surface.id
  let tabID = try #require(host.selectedTabID)
  let harness = ClaudeHookHarness(
    context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue),
    host: host,
    registry: registry,
    tabID: tabID,
    window: window
  )
  registry.updateWindow(window, for: windowControllerID)
  return harness
}

struct ClaudeHookHarness {
  let context: SupatermCLIContext
  let tabID: TerminalTabID
  private let hostStorage: TerminalHostState
  private let registry: TerminalWindowRegistry
  private let window: NSWindow

  var commandExecutor: TerminalCommandExecutor {
    TerminalCommandExecutor(registry: registry)
  }

  var host: TerminalHostState {
    withExtendedLifetime(window) { hostStorage }
  }

  init(
    context: SupatermCLIContext,
    host: TerminalHostState,
    registry: TerminalWindowRegistry,
    tabID: TerminalTabID,
    window: NSWindow
  ) {
    self.context = context
    self.hostStorage = host
    self.registry = registry
    self.tabID = tabID
    self.window = window
  }
}

func makeCommandExecutor(registry: TerminalWindowRegistry) -> TerminalCommandExecutor {
  let commandExecutor = TerminalCommandExecutor(registry: registry)
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
  func setTestAgentActivity(_ activity: AgentActivity, for surfaceID: UUID) -> Bool {
    applyTestAgentActivity(
      activity,
      for: surfaceID,
      sessionID: "test-\(activity.identity.id)-\(surfaceID.uuidString)",
      processID: nil
    )
  }

  @discardableResult
  func startTestAgentSession(
    agent: SupatermAgentKind,
    for surfaceID: UUID,
    sessionID: String?,
    processID: Int32?,
    workingDirectoryPath: String? = nil
  ) -> Bool {
    guard let sessionID, let tabID = tabID(containing: surfaceID) else { return false }
    return applyAgentEvent(
      TerminalAgentEvent(
        scope: TerminalAgentEvent.Scope(agent: agent, sessionID: sessionID),
        context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue),
        processID: processID,
        workingDirectoryPath: workingDirectoryPath,
        action: .sessionResumed
      )
    ).changed
  }

  @discardableResult
  func applyTestAgentActivity(
    _ activity: AgentActivity,
    for surfaceID: UUID,
    sessionID: String?,
    processID: Int32?,
    workingDirectoryPath: String? = nil
  ) -> Bool {
    guard let agent = SupatermAgentKind(rawValue: activity.identity.id),
      let sessionID,
      let tabID = tabID(containing: surfaceID)
    else {
      return false
    }
    let resolvedProcessID = processID ?? getpid()
    if !hasAgentSession(agent: agent, sessionID: sessionID) {
      _ = startTestAgentSession(
        agent: agent,
        for: surfaceID,
        sessionID: sessionID,
        processID: resolvedProcessID
      )
    }
    let action: TerminalAgentEvent.Action =
      switch activity.phase {
      case .unknown: .sessionResumed
      case .idle: .turnCompleted(message: nil)
      case .needsInput: .attentionRequested(requestID: nil, message: activity.detail)
      case .running: .turnRunning(detail: activity.detail)
      }
    let changed = applyAgentEvent(
      TerminalAgentEvent(
        scope: TerminalAgentEvent.Scope(agent: agent, sessionID: sessionID),
        context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue),
        processID: resolvedProcessID,
        workingDirectoryPath: workingDirectoryPath,
        action: action
      )
    ).changed
    return applyTestAgentDetection(
      agent: agent,
      phase: activity.phase,
      processID: resolvedProcessID,
      surfaceID: surfaceID
    ) || changed
  }

  @discardableResult
  func makeTestAgentSessionActionable(
    agent: SupatermAgentKind,
    for surfaceID: UUID,
    sessionID: String?,
    processID: Int32?,
    workingDirectoryPath: String? = nil
  ) -> Bool {
    guard let sessionID, let tabID = tabID(containing: surfaceID) else { return false }
    let resolvedProcessID = processID ?? getpid()
    if !hasAgentSession(agent: agent, sessionID: sessionID) {
      _ = startTestAgentSession(
        agent: agent,
        for: surfaceID,
        sessionID: sessionID,
        processID: resolvedProcessID,
        workingDirectoryPath: workingDirectoryPath
      )
    }
    let changed = applyAgentEvent(
      TerminalAgentEvent(
        scope: TerminalAgentEvent.Scope(agent: agent, sessionID: sessionID),
        context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue),
        processID: resolvedProcessID,
        workingDirectoryPath: workingDirectoryPath,
        action: .turnCompleted(message: nil)
      )
    ).changed
    return applyTestAgentDetection(
      agent: agent,
      phase: .idle,
      processID: resolvedProcessID,
      surfaceID: surfaceID
    ) || changed
  }

  private func applyTestAgentDetection(
    agent: SupatermAgentKind,
    phase: AgentActivityPhase,
    processID: Int32,
    surfaceID: UUID
  ) -> Bool {
    guard agent != .pi,
      let processIdentity = TerminalAgentProcessInspector.identity(for: processID),
      let revision = agentStateStore.snapshots(for: surfaceID).map(\.revision).max()
    else {
      return false
    }
    return applyAgentDetection(
      TerminalAgentDetectionObservation(
        agent: AgentDetectionAgentIdentity(agent),
        phase: phase,
        processIdentity: processIdentity,
        ruleID: "test",
        generation: 1,
        sequence: UInt64(max(1, revision))
      ),
      for: surfaceID
    )
  }

  @discardableResult
  func setTestAgentResponse(
    _ message: String,
    for surfaceID: UUID
  ) -> Bool {
    guard let target = testAgentTarget(for: surfaceID) else { return false }
    _ = applyAgentEvent(
      TerminalAgentEvent(
        scope: target.scope,
        context: target.context,
        action: .turnStarted
      )
    )
    return applyAgentEvent(
      TerminalAgentEvent(
        scope: target.scope,
        context: target.context,
        action: .turnCompleted(message: message)
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
        action: .progressUpdated(.replace(progressRows))
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
      context: SupatermCLIContext(surfaceID: surfaceID, tabID: tabID.rawValue)
    )
  }
}
