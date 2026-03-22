import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermSocketProtocolTests {
  @Test
  func managedSocketURLUsesPerUserTmpDirectory() {
    let rootDirectory = URL(fileURLWithPath: "/tmp/SupatermTests", isDirectory: true)
    let endpointID = UUID(uuidString: "46AF523B-6B85-4DDB-B6E6-C5E87F9BAA94")!

    #expect(
      SupatermSocketPath.managedSocketURL(
        endpointID: endpointID,
        rootDirectory: rootDirectory,
        userID: 501
      )
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
        .appendingPathComponent(endpointID.uuidString, isDirectory: false)
        .appendingPathExtension("sock")
    )
  }

  @Test
  func canonicalizedPromotesTmpPathsToPrivateTmp() {
    #expect(
      SupatermSocketPath.canonicalized("/tmp/supaterm-501/control.sock")
        == "/private/tmp/supaterm-501/control.sock"
    )
    #expect(
      SupatermSocketPath.canonicalized("/tmp/SupatermTests")
        == "/private/tmp/SupatermTests"
    )
  }

  @Test
  func managedSocketURLFitsDarwinSocketLimit() {
    let path = SupatermSocketPath.managedSocketURL(
      endpointID: UUID(uuidString: "46AF523B-6B85-4DDB-B6E6-C5E87F9BAA94")!,
      userID: 501
    ).path

    #expect(path.utf8.count < 104)
  }

  @Test
  func socketEndpointDisplayStringIncludesShortIDPidAndPath() {
    let endpoint = socketEndpoint(
      id: UUID(uuidString: "FC905729-0A5F-4D1D-8077-5E0E90529B86")!,
      name: "main",
      path: "/tmp/main.sock",
      pid: 77,
      startedAt: 3
    )

    #expect(endpoint.displayString == "main [FC905729] pid 77 socket /tmp/main.sock")
  }

  @Test
  func explicitPathResolutionPrefersExplicitPathThenEnvironment() {
    let environmentPath = "/tmp/supaterm.environment.sock"
    let explicitPath = "/tmp/supaterm.explicit.sock"

    #expect(
      SupatermSocketPath.resolveExplicitPath(
        explicitPath: explicitPath,
        environment: [SupatermCLIEnvironment.socketPathKey: environmentPath]
      ) == explicitPath
    )
    #expect(
      SupatermSocketPath.resolveExplicitPath(
        environment: [SupatermCLIEnvironment.socketPathKey: environmentPath]
      ) == environmentPath
    )
    #expect(SupatermSocketPath.resolveExplicitPath(environment: [:]) == nil)
  }

  @Test
  func processSocketEndpointUsesManagedPathAndInstanceName() {
    let rootDirectory = URL(fileURLWithPath: "/tmp/SupatermTests", isDirectory: true)
    let endpointID = UUID(uuidString: "C46492BD-5A6E-4C73-8D0F-71AFBA7EF1DE")!
    let startedAt = Date(timeIntervalSince1970: 123)

    let endpoint = SupatermProcessSocketEndpoint.make(
      environment: [SupatermCLIEnvironment.instanceNameKey: "dev"],
      endpointID: endpointID,
      processID: 99,
      startedAt: startedAt,
      rootDirectory: rootDirectory,
      userID: 501
    )

    #expect(
      endpoint
        == .init(
          id: endpointID,
          name: "dev",
          path:
            URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
            .appendingPathComponent("supaterm-501", isDirectory: true)
            .appendingPathComponent(endpointID.uuidString, isDirectory: false)
            .appendingPathExtension("sock")
            .path,
          pid: 99,
          startedAt: startedAt
        )
    )
  }

  @Test
  func processSocketEndpointIgnoresInheritedSocketPath() {
    let rootDirectory = URL(fileURLWithPath: "/tmp/SupatermTests", isDirectory: true)
    let endpointID = UUID(uuidString: "0DC934AE-CE34-4B47-B968-B70E0A1E8733")!
    let endpoint = SupatermProcessSocketEndpoint.make(
      environment: [
        SupatermCLIEnvironment.socketPathKey: "/tmp/override.sock",
        SupatermCLIEnvironment.instanceNameKey: "named",
      ],
      endpointID: endpointID,
      processID: 7,
      startedAt: Date(timeIntervalSince1970: 456),
      rootDirectory: rootDirectory,
      userID: 501
    )

    #expect(
      endpoint?.path
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
        .appendingPathComponent(endpointID.uuidString, isDirectory: false)
        .appendingPathExtension("sock")
        .path
    )
    #expect(endpoint?.name == "named")
  }

  @Test
  func socketTargetResolverHonorsPrecedenceAndAmbiguity() throws {
    let alpha = socketEndpoint(
      id: UUID(uuidString: "86DB92A0-7F32-4493-9217-F0B29D81B39C")!,
      name: "alpha",
      path: "/tmp/alpha.sock",
      pid: 1,
      startedAt: 2
    )
    let beta = socketEndpoint(
      id: UUID(uuidString: "4B337D2A-99A2-4FB2-BB72-C3C3A2AB62D2")!,
      name: "beta",
      path: "/tmp/beta.sock",
      pid: 2,
      startedAt: 1
    )

    #expect(
      try SupatermSocketTargetResolver.resolve(
        explicitPath: "/tmp/explicit.sock",
        environmentPath: "/tmp/environment.sock",
        instance: "alpha",
        discoveredEndpoints: [alpha, beta]
      ) == .init(endpoint: nil, path: "/tmp/explicit.sock", source: .explicitPath)
    )

    #expect(
      try SupatermSocketTargetResolver.resolve(
        explicitPath: nil,
        environmentPath: "/tmp/environment.sock",
        instance: "alpha",
        discoveredEndpoints: [alpha, beta]
      ) == .init(endpoint: nil, path: "/tmp/environment.sock", source: .environmentPath)
    )

    #expect(
      try SupatermSocketTargetResolver.resolve(
        explicitPath: nil,
        environmentPath: nil,
        instance: alpha.id.uuidString,
        discoveredEndpoints: [alpha, beta]
      ) == .init(endpoint: alpha, path: alpha.path, source: .explicitInstance)
    )

    #expect(
      try SupatermSocketTargetResolver.resolve(
        explicitPath: nil,
        environmentPath: nil,
        instance: "beta",
        discoveredEndpoints: [alpha, beta]
      ) == .init(endpoint: beta, path: beta.path, source: .explicitInstance)
    )

    #expect(
      try SupatermSocketTargetResolver.resolve(
        explicitPath: nil,
        environmentPath: nil,
        instance: alpha.id.uuidString.lowercased(),
        discoveredEndpoints: [alpha, beta]
      ) == .init(endpoint: alpha, path: alpha.path, source: .explicitInstance)
    )

    do {
      _ = try SupatermSocketTargetResolver.resolve(
        explicitPath: nil,
        environmentPath: nil,
        instance: nil,
        discoveredEndpoints: [alpha, beta]
      )
      Issue.record("Expected ambiguous discovered instances.")
    } catch let error as SupatermSocketSelectionError {
      #expect(error == .ambiguousDiscoveredInstances([alpha, beta]))
    }
  }

  @Test
  func managedSocketDiscoveryRemovesOnlyStalePathsAndSortsEndpoints() {
    let older = socketEndpoint(
      id: UUID(uuidString: "99E743B9-198E-4109-A8D3-5DF618FF56AB")!,
      name: "older",
      path: "/tmp/older.sock",
      pid: 1,
      startedAt: 1
    )
    let newer = socketEndpoint(
      id: UUID(uuidString: "F20D93D7-D7E0-4667-A695-98620E4686C9")!,
      name: "newer",
      path: "/tmp/newer.sock",
      pid: 2,
      startedAt: 2
    )
    var removed: [String] = []

    let discovery = SupatermManagedSocketDiscovery.discover(
      candidatePaths: [older.path, "/tmp/ignored.sock", "/tmp/stale.sock", newer.path],
      probe: { path in
        switch path {
        case older.path:
          return .reachable(older)
        case newer.path:
          return .reachable(newer)
        case "/tmp/ignored.sock":
          return .ignored
        default:
          return .stale
        }
      },
      removeStalePath: { path in
        removed.append(path)
      }
    )

    #expect(discovery.reachableEndpoints == [newer, older])
    #expect(discovery.removedStalePaths == ["/tmp/stale.sock"])
    #expect(removed == ["/tmp/stale.sock"])
  }

  @Test
  func requestAndResponseRoundTripAsJSON() throws {
    let encoder = JSONEncoder()
    let decoder = JSONDecoder()
    let request = SupatermSocketRequest(
      id: "request-1",
      method: SupatermSocketMethod.systemPing,
      params: [
        "nested": ["pong": true],
        "null": nil,
      ]
    )
    let response = SupatermSocketResponse.ok(
      id: "request-1",
      result: ["pong": true]
    )

    #expect(
      try decoder.decode(
        SupatermSocketRequest.self,
        from: encoder.encode(request)
      ) == request
    )
    #expect(
      try decoder.decode(
        SupatermSocketResponse.self,
        from: encoder.encode(response)
      ) == response
    )
  }

  @Test
  func identityRequestAndEndpointRoundTripThroughTypedHelpers() throws {
    let endpoint = socketEndpoint(
      id: UUID(uuidString: "FC905729-0A5F-4D1D-8077-5E0E90529B86")!,
      name: "main",
      path: "/tmp/main.sock",
      pid: 77,
      startedAt: 3
    )
    let request = SupatermSocketRequest.identity(id: "identity-1")
    let response = try SupatermSocketResponse.ok(id: "identity-1", encodableResult: endpoint)

    #expect(request.method == SupatermSocketMethod.systemIdentity)
    #expect(try response.decodeResult(SupatermSocketEndpoint.self) == endpoint)
  }

  @Test
  func treeRequestAndSnapshotRoundTripThroughTypedHelpers() throws {
    let tab = SupatermTreeSnapshot.Tab(
      index: 1,
      title: "zsh",
      isSelected: true,
      panes: [
        .init(index: 1, isFocused: true),
        .init(index: 2, isFocused: false),
      ]
    )
    let space = SupatermTreeSnapshot.Space(
      index: 1,
      name: "A",
      isSelected: true,
      tabs: [tab]
    )
    let window = SupatermTreeSnapshot.Window(
      index: 1,
      isKey: true,
      spaces: [space]
    )
    let snapshot = SupatermTreeSnapshot(
      windows: [window]
    )

    let request = SupatermSocketRequest.tree(id: "tree-1")
    let response = try SupatermSocketResponse.ok(id: "tree-1", encodableResult: snapshot)

    #expect(request.method == SupatermSocketMethod.appTree)
    #expect(try response.decodeResult(SupatermTreeSnapshot.self) == snapshot)
  }

  @Test
  func onboardingRequestAndSnapshotRoundTripThroughTypedHelpers() throws {
    let snapshot = SupatermOnboardingSnapshot(
      items: [
        .init(shortcut: "⌘S", title: "Toggle sidebar"),
        .init(shortcut: "⌘T", title: "New tab"),
      ]
    )

    let request = SupatermSocketRequest.onboarding(id: "onboarding-1")
    let response = try SupatermSocketResponse.ok(id: "onboarding-1", encodableResult: snapshot)

    #expect(request.method == SupatermSocketMethod.appOnboarding)
    #expect(try response.decodeResult(SupatermOnboardingSnapshot.self) == snapshot)
  }

  @Test
  func debugRequestAndSnapshotRoundTripThroughTypedHelpers() throws {
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "20D1A721-EA1E-44FB-B46D-29FBF240D4CB")!,
      tabID: UUID(uuidString: "9C643643-2288-42E1-88C1-79AFEF4D40CA")!
    )
    let pane = SupatermAppDebugSnapshot.Pane(
      index: 1,
      id: context.surfaceID,
      isFocused: true,
      displayTitle: "zsh",
      pwd: "/tmp",
      isReadOnly: false,
      hasSecureInput: false,
      bellCount: 0,
      isRunning: true,
      progressState: "indeterminate",
      progressValue: nil,
      needsCloseConfirmation: true,
      lastCommandExitCode: 0,
      lastCommandDurationMs: 120,
      lastChildExitCode: nil,
      lastChildExitTimeMs: nil
    )
    let tab = SupatermAppDebugSnapshot.Tab(
      index: 1,
      id: context.tabID,
      title: "zsh",
      isSelected: true,
      isPinned: false,
      isDirty: true,
      isTitleLocked: false,
      hasRunningActivity: true,
      hasBell: false,
      hasReadOnly: false,
      hasSecureInput: false,
      panes: [pane]
    )
    let space = SupatermAppDebugSnapshot.Space(
      index: 1,
      id: UUID(uuidString: "3006D18B-D5B7-47E5-9632-5BFD80C1FF21")!,
      name: "A",
      isSelected: true,
      tabs: [tab]
    )
    let window = SupatermAppDebugSnapshot.Window(
      index: 1,
      isKey: true,
      isVisible: true,
      spaces: [space]
    )
    let snapshot = SupatermAppDebugSnapshot(
      build: .init(
        version: "1.2.3",
        buildNumber: "45",
        isDevelopmentBuild: true,
        usesStubUpdateChecks: true
      ),
      update: .init(
        canCheckForUpdates: true,
        phase: "checking",
        detail: "Please wait while Supaterm checks for available updates."
      ),
      summary: .init(
        windowCount: 1,
        spaceCount: 1,
        tabCount: 1,
        paneCount: 1,
        keyWindowIndex: 1
      ),
      currentTarget: .init(
        windowIndex: 1,
        spaceIndex: 1,
        spaceID: space.id,
        spaceName: space.name,
        tabIndex: 1,
        tabID: context.tabID,
        tabTitle: tab.title,
        paneIndex: 1,
        paneID: context.surfaceID
      ),
      windows: [window],
      problems: []
    )

    let request = try SupatermSocketRequest.debug(
      .init(context: context),
      id: "debug-1"
    )
    let response = try SupatermSocketResponse.ok(id: "debug-1", encodableResult: snapshot)

    #expect(request.method == SupatermSocketMethod.appDebug)
    #expect(try request.decodeParams(SupatermDebugRequest.self) == .init(context: context))
    #expect(try response.decodeResult(SupatermAppDebugSnapshot.self) == snapshot)
  }

  @Test
  func newPaneRequestAndResponseRoundTripThroughTypedHelpers() throws {
    let requestPayload = SupatermNewPaneRequest(
      command: "pwd",
      direction: .down,
      focus: false,
      targetWindowIndex: 1,
      targetSpaceIndex: 2,
      targetTabIndex: 1,
      targetPaneIndex: 2
    )
    let result = SupatermNewPaneResult(
      direction: .down,
      isFocused: false,
      isSelectedTab: true,
      windowIndex: 1,
      spaceIndex: 2,
      tabIndex: 1,
      paneIndex: 3
    )

    let request = try SupatermSocketRequest.newPane(requestPayload, id: "new-pane-1")
    let response = try SupatermSocketResponse.ok(id: "new-pane-1", encodableResult: result)

    #expect(request.method == SupatermSocketMethod.terminalNewPane)
    #expect(try request.decodeParams(SupatermNewPaneRequest.self) == requestPayload)
    #expect(try response.decodeResult(SupatermNewPaneResult.self) == result)
  }
}

private func socketEndpoint(
  id: UUID,
  name: String,
  path: String,
  pid: Int32,
  startedAt: TimeInterval
) -> SupatermSocketEndpoint {
  .init(
    id: id,
    name: name,
    path: path,
    pid: pid,
    startedAt: .init(timeIntervalSince1970: startedAt)
  )
}
