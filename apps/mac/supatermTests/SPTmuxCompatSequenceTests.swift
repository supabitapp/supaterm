import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPTmuxCompatSequenceTests {
  @Test
  func teammateLayoutSequenceMatchesClaudeTmuxBackend() throws {
    let transport = SPTmuxTransportStub()
    let runner = SPTmuxCommandRunner(
      transport: transport,
      environment: [
        SupatermCLIEnvironment.surfaceIDKey: transport.leaderPaneID.uuidString,
        SupatermCLIEnvironment.tabIDKey: transport.tabID.uuidString,
        "TMUX": "/tmp/tmux-123/default,123,0",
        "TMUX_PANE": "%\(transport.leaderPaneID.uuidString.lowercased())",
      ]
    )

    try runner.run(arguments: [
      "split-window",
      "-t", "%\(transport.leaderPaneID.uuidString.lowercased())",
      "-h",
      "-l", "70%",
    ])

    let firstTeammatePaneID = try #require(transport.paneIDs.dropFirst().first)

    try runner.run(arguments: [
      "split-window",
      "-t", "%\(firstTeammatePaneID.uuidString.lowercased())",
      "-v",
    ])

    try runner.run(arguments: [
      "select-layout",
      "-t", "\(transport.spaceName):\(transport.tabIndex)",
      "main-vertical",
    ])

    try runner.run(arguments: [
      "resize-pane",
      "-t", "%\(transport.leaderPaneID.uuidString.lowercased())",
      "-x", "30%",
    ])

    let terminalRequests = transport.requests.filter { $0.method.hasPrefix("terminal.") }
    #expect(
      terminalRequests.map(\.method) == [
        SupatermSocketMethod.terminalNewPane,
        SupatermSocketMethod.terminalSetPaneSize,
        SupatermSocketMethod.terminalNewPane,
        SupatermSocketMethod.terminalMainVerticalPanes,
        SupatermSocketMethod.terminalSetPaneSize,
      ]
    )

    let firstSplitRequest = try terminalRequests[0].decodeParams(SupatermNewPaneRequest.self)
    #expect(firstSplitRequest.direction == .right)
    #expect(firstSplitRequest.equalize == false)
    #expect(firstSplitRequest.focus == false)
    #expect(firstSplitRequest.targetPaneIndex == 1)

    let firstSplitSizeRequest = try terminalRequests[1].decodeParams(SupatermSetPaneSizeRequest.self)
    #expect(firstSplitSizeRequest.amount == 70)
    #expect(firstSplitSizeRequest.axis == .horizontal)
    #expect(firstSplitSizeRequest.unit == .percent)
    #expect(firstSplitSizeRequest.target.targetPaneIndex == 2)

    let secondSplitRequest = try terminalRequests[2].decodeParams(SupatermNewPaneRequest.self)
    #expect(secondSplitRequest.direction == .down)
    #expect(secondSplitRequest.equalize == false)
    #expect(secondSplitRequest.focus == false)
    #expect(secondSplitRequest.targetPaneIndex == 2)

    let mainVerticalRequest = try terminalRequests[3].decodeParams(SupatermTabTargetRequest.self)
    #expect(mainVerticalRequest.targetWindowIndex == 1)
    #expect(mainVerticalRequest.targetSpaceIndex == 1)
    #expect(mainVerticalRequest.targetTabIndex == 1)

    let leaderSizeRequest = try terminalRequests[4].decodeParams(SupatermSetPaneSizeRequest.self)
    #expect(leaderSizeRequest.amount == 30)
    #expect(leaderSizeRequest.axis == .horizontal)
    #expect(leaderSizeRequest.unit == .percent)
    #expect(leaderSizeRequest.target.targetPaneIndex == 1)
  }
}

private final class SPTmuxTransportStub: SPTmuxTransport {
  struct PaneState {
    let index: Int
    let id: UUID
    let isFocused: Bool
  }

  struct State {
    let windowIndex = 1
    let spaceIndex = 1
    let spaceID = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
    let spaceName = "main"
    let tabIndex = 1
    let tabID = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
    let tabTitle = "supaterm"
    var panes: [PaneState] = [
      .init(index: 1, id: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!, isFocused: true)
    ]
    var nextPaneIDs: [UUID] = [
      UUID(uuidString: "44444444-4444-4444-4444-444444444444")!,
      UUID(uuidString: "55555555-5555-5555-5555-555555555555")!,
      UUID(uuidString: "66666666-6666-6666-6666-666666666666")!,
    ]

    var leaderPaneID: UUID {
      panes[0].id
    }

    var currentPaneID: UUID {
      panes.first(where: \.isFocused)?.id ?? leaderPaneID
    }

    mutating func newPane(_ request: SupatermNewPaneRequest) -> SupatermNewPaneResult {
      let paneID = nextPaneIDs.removeFirst()
      let pane = PaneState(
        index: panes.count + 1,
        id: paneID,
        isFocused: request.focus
      )
      if request.focus {
        panes = panes.map { .init(index: $0.index, id: $0.id, isFocused: false) }
      }
      panes.append(pane)
      return .init(
        direction: request.direction,
        isFocused: request.focus,
        isSelectedTab: true,
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        spaceID: spaceID,
        tabIndex: tabIndex,
        tabID: tabID,
        paneIndex: pane.index,
        paneID: paneID
      )
    }

    func paneTarget(for request: SupatermPaneTargetRequest) throws -> SupatermPaneTarget {
      guard let pane = panes.first(where: { $0.index == request.targetPaneIndex }) else {
        throw POSIXError(.ENOENT)
      }
      return .init(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        spaceID: spaceID,
        tabIndex: tabIndex,
        tabID: tabID,
        paneIndex: pane.index,
        paneID: pane.id
      )
    }

    func tabTarget() -> SupatermTabTarget {
      .init(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        spaceID: spaceID,
        tabIndex: tabIndex,
        tabID: tabID,
        title: tabTitle
      )
    }

    func debugSnapshot() -> SupatermAppDebugSnapshot {
      let debugPanes = panes.map {
        SupatermAppDebugSnapshot.Pane(
          index: $0.index,
          id: $0.id,
          isFocused: $0.isFocused,
          displayTitle: "pane-\($0.index)",
          pwd: "/tmp",
          isReadOnly: false,
          hasSecureInput: false,
          bellCount: 0,
          isRunning: false,
          progressState: nil,
          progressValue: nil,
          needsCloseConfirmation: false,
          lastCommandExitCode: nil,
          lastCommandDurationMs: nil,
          lastChildExitCode: nil,
          lastChildExitTimeMs: nil
        )
      }
      let debugTab = SupatermAppDebugSnapshot.Tab(
        index: tabIndex,
        id: tabID,
        title: tabTitle,
        isSelected: true,
        isPinned: false,
        isDirty: false,
        isTitleLocked: false,
        hasRunningActivity: false,
        hasBell: false,
        hasReadOnly: false,
        hasSecureInput: false,
        panes: debugPanes
      )
      let debugSpace = SupatermAppDebugSnapshot.Space(
        index: spaceIndex,
        id: spaceID,
        name: spaceName,
        isSelected: true,
        tabs: [debugTab]
      )
      let debugWindow = SupatermAppDebugSnapshot.Window(
        index: windowIndex,
        isKey: true,
        isVisible: true,
        spaces: [debugSpace]
      )
      return .init(
        build: .init(
          version: "1.0",
          buildNumber: "1",
          isDevelopmentBuild: true,
          usesStubUpdateChecks: false
        ),
        update: .init(
          canCheckForUpdates: true,
          phase: "idle",
          detail: ""
        ),
        summary: .init(
          windowCount: 1,
          spaceCount: 1,
          tabCount: 1,
          paneCount: panes.count,
          keyWindowIndex: windowIndex
        ),
        currentTarget: .init(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          spaceID: spaceID,
          spaceName: spaceName,
          tabIndex: tabIndex,
          tabID: tabID,
          tabTitle: tabTitle,
          paneIndex: panes.first(where: { $0.id == currentPaneID })?.index,
          paneID: currentPaneID
        ),
        windows: [debugWindow],
        problems: []
      )
    }
  }

  var leaderPaneID: UUID {
    state.leaderPaneID
  }

  var paneIDs: [UUID] {
    state.panes.map(\.id)
  }

  var requests: [SupatermSocketRequest] = []
  var spaceName: String {
    state.spaceName
  }

  var tabID: UUID {
    state.tabID
  }

  var tabIndex: Int {
    state.tabIndex
  }

  private var state = State()

  func send(_ request: SupatermSocketRequest) throws -> SupatermSocketResponse {
    requests.append(request)

    switch request.method {
    case SupatermSocketMethod.appDebug:
      return try .ok(id: request.id, encodableResult: state.debugSnapshot())

    case SupatermSocketMethod.terminalNewPane:
      let payload = try request.decodeParams(SupatermNewPaneRequest.self)
      return try .ok(id: request.id, encodableResult: state.newPane(payload))

    case SupatermSocketMethod.terminalSetPaneSize:
      let payload = try request.decodeParams(SupatermSetPaneSizeRequest.self)
      return try .ok(id: request.id, encodableResult: try state.paneTarget(for: payload.target))

    case SupatermSocketMethod.terminalMainVerticalPanes:
      _ = try request.decodeParams(SupatermTabTargetRequest.self)
      return try .ok(id: request.id, encodableResult: state.tabTarget())

    default:
      throw NSError(
        domain: "SPTmuxTransportStub", code: 1,
        userInfo: [
          NSLocalizedDescriptionKey: "Unsupported request: \(request.method)"
        ])
    }
  }
}
