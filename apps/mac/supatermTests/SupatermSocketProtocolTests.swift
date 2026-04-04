import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermSocketProtocolTests {
  @Test
  func managedDirectoryURLPrefersXDGThenTMPDIRThenTmp() {
    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [
          "XDG_RUNTIME_DIR": "/run/user/501",
          "TMPDIR": "/tmp/ignored",
        ],
        userID: 501
      )
        == URL(fileURLWithPath: "/run/user/501", isDirectory: true)
        .appendingPathComponent("supaterm", isDirectory: true)
    )

    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [
          "TMPDIR": "/tmp/SupatermTests"
        ],
        userID: 501
      )
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
    )

    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [:],
        userID: 501
      )
        == URL(fileURLWithPath: "/private/tmp", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
    )
  }

  @Test
  func managedDirectoryURLIgnoresBlankEnvironmentValuesAndTrailingSlashes() {
    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [
          "XDG_RUNTIME_DIR": "   ",
          "TMPDIR": "/tmp/SupatermTests///",
        ],
        userID: 501
      )
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
    )

    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [
          "XDG_RUNTIME_DIR": "   ",
          "TMPDIR": "   ",
        ],
        userID: 501
      )
        == URL(fileURLWithPath: "/private/tmp", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
    )
  }

  @Test
  func managedSocketURLFitsDarwinSocketLimit() {
    let path = SupatermSocketPath.managedSocketURL(
      processID: 501,
      userID: 501
    ).path

    #expect(path.utf8.count < 104)
  }

  @Test
  func managedSocketURLUsesOverrideAsTempStyleRoot() {
    let rootDirectory = URL(fileURLWithPath: "/tmp/SupatermTests", isDirectory: true)

    #expect(
      SupatermSocketPath.managedSocketURL(
        processID: 77,
        rootDirectory: rootDirectory,
        environment: [
          "XDG_RUNTIME_DIR": "/run/user/501",
          "TMPDIR": "/tmp/ignored",
        ],
        userID: 501
      )
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
        .appendingPathComponent("pid-77", isDirectory: false)
    )
  }

  @Test
  func canonicalizedResolvesSymlinkedPaths() throws {
    let rootURL = try makeSocketProtocolTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let actualURL = rootURL.appendingPathComponent("actual", isDirectory: true)
    let symlinkURL = rootURL.appendingPathComponent("link", isDirectory: true)
    try FileManager.default.createDirectory(at: actualURL, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: symlinkURL, withDestinationURL: actualURL)

    #expect(
      SupatermSocketPath.canonicalized(
        symlinkURL.appendingPathComponent("control.sock", isDirectory: false).path
      ) == actualURL.appendingPathComponent("control.sock", isDirectory: false).path
    )
    #expect(
      SupatermSocketPath.managedDirectoryURL(
        rootDirectory: symlinkURL,
        environment: [:],
        userID: 501
      ) == actualURL.appendingPathComponent("supaterm-501", isDirectory: true)
    )
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
  func processSocketEndpointUsesEnvironmentSelectedManagedPathAndInstanceName() {
    let endpointID = UUID(uuidString: "C46492BD-5A6E-4C73-8D0F-71AFBA7EF1DE")!
    let startedAt = Date(timeIntervalSince1970: 123)

    let endpoint = SupatermProcessSocketEndpoint.make(
      environment: [
        "XDG_RUNTIME_DIR": "/run/user/501",
        SupatermCLIEnvironment.instanceNameKey: "dev",
      ],
      endpointID: endpointID,
      processID: 99,
      startedAt: startedAt,
      userID: 501
    )

    #expect(
      endpoint
        == .init(
          id: endpointID,
          name: "dev",
          path:
            URL(fileURLWithPath: "/run/user/501", isDirectory: true)
            .appendingPathComponent("supaterm", isDirectory: true)
            .appendingPathComponent("pid-99", isDirectory: false)
            .path,
          pid: 99,
          startedAt: startedAt
        )
    )
  }

  @Test
  func processSocketEndpointIgnoresInheritedSocketPath() {
    let endpointID = UUID(uuidString: "0DC934AE-CE34-4B47-B968-B70E0A1E8733")!
    let endpoint = SupatermProcessSocketEndpoint.make(
      environment: [
        "TMPDIR": "/tmp/SupatermTests",
        SupatermCLIEnvironment.socketPathKey: "/tmp/override.sock",
        SupatermCLIEnvironment.instanceNameKey: "named",
      ],
      endpointID: endpointID,
      processID: 7,
      startedAt: Date(timeIntervalSince1970: 456),
      userID: 501
    )

    #expect(
      endpoint?.path
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
        .appendingPathComponent("pid-7", isDirectory: false)
        .path
    )
    #expect(endpoint?.name == "named")
  }

  @Test
  func processSocketEndpointPathDependsOnProcessIDNotEndpointID() {
    let first = SupatermProcessSocketEndpoint.make(
      environment: ["TMPDIR": "/tmp/SupatermTests"],
      endpointID: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
      processID: 42,
      startedAt: .init(timeIntervalSince1970: 0),
      userID: 501
    )
    let second = SupatermProcessSocketEndpoint.make(
      environment: ["TMPDIR": "/tmp/SupatermTests"],
      endpointID: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
      processID: 42,
      startedAt: .init(timeIntervalSince1970: 1),
      userID: 501
    )

    #expect(first?.path == second?.path)
    #expect(
      first?.path
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
        .appendingPathComponent("pid-42", isDirectory: false)
        .path
    )
  }

  @Test
  func isManagedSocketPathRecognizesXdgAndTempLayouts() {
    #expect(
      SupatermSocketPath.isManagedSocketPath(
        "/run/user/501/supaterm/control.sock",
        environment: ["XDG_RUNTIME_DIR": "/run/user/501"],
        userID: 501
      )
    )
    #expect(
      SupatermSocketPath.isManagedSocketPath(
        "/private/tmp/SupatermTests/supaterm-501/control.sock",
        environment: ["TMPDIR": "/tmp/SupatermTests"],
        userID: 501
      )
    )
    #expect(
      !SupatermSocketPath.isManagedSocketPath(
        "/run/user/501/not-supaterm/control.sock",
        environment: ["XDG_RUNTIME_DIR": "/run/user/501"],
        userID: 501
      )
    )
  }

  @Test
  func discoverManagedSocketPathsUsesEnvironmentSelectedDirectory() throws {
    let rootURL = try makeSocketProtocolTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let xdgRuntimeDirectory = rootURL.appendingPathComponent("xdg", isDirectory: true)
    let xdgManagedDirectory = xdgRuntimeDirectory.appendingPathComponent(
      "supaterm", isDirectory: true)
    let tmpDirectory = rootURL.appendingPathComponent("tmp", isDirectory: true)
    let tmpManagedDirectory =
      tmpDirectory
      .appendingPathComponent("supaterm-\(getuid())", isDirectory: true)
    try FileManager.default.createDirectory(
      at: xdgManagedDirectory, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(
      at: tmpManagedDirectory, withIntermediateDirectories: true)

    let xdgSocketURL = xdgManagedDirectory.appendingPathComponent("xdg.sock", isDirectory: false)
    let tmpSocketURL = tmpManagedDirectory.appendingPathComponent("tmp.sock", isDirectory: false)
    try createSocketNode(at: xdgSocketURL)
    try createSocketNode(at: tmpSocketURL)

    #expect(
      SupatermSocketPath.discoverManagedSocketPaths(
        environment: [
          "XDG_RUNTIME_DIR": xdgRuntimeDirectory.path,
          "TMPDIR": tmpDirectory.path,
        ]
      ) == [xdgSocketURL.path]
    )
    #expect(
      SupatermSocketPath.discoverManagedSocketPaths(
        environment: ["TMPDIR": tmpDirectory.path]
      ) == [tmpSocketURL.path]
    )
  }

  @Test
  func discoverManagedSocketPathsCanonicalizesSymlinkedTmpDirectory() throws {
    let rootURL = try makeSocketProtocolTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let actualDirectory = rootURL.appendingPathComponent("actual", isDirectory: true)
    let symlinkDirectory = rootURL.appendingPathComponent("link", isDirectory: true)
    let managedDirectory =
      actualDirectory
      .appendingPathComponent("supaterm-\(getuid())", isDirectory: true)
    try FileManager.default.createDirectory(at: managedDirectory, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(
      at: symlinkDirectory, withDestinationURL: actualDirectory)

    let socketURL = managedDirectory.appendingPathComponent("control.sock", isDirectory: false)
    try createSocketNode(at: socketURL)

    #expect(
      SupatermSocketPath.discoverManagedSocketPaths(
        environment: ["TMPDIR": symlinkDirectory.path]
      ) == [socketURL.path]
    )
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
      id: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      title: "zsh",
      isSelected: true,
      panes: [
        .init(
          index: 1,
          id: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!,
          isFocused: true
        ),
        .init(
          index: 2,
          id: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!,
          isFocused: false
        ),
      ]
    )
    let space = SupatermTreeSnapshot.Space(
      index: 1,
      id: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
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
  func newTabRequestAndResponseRoundTripThroughTypedHelpers() throws {
    let requestPayload = SupatermNewTabRequest(
      command: "pwd",
      cwd: "/tmp/example",
      focus: false,
      targetWindowIndex: 1,
      targetSpaceIndex: 2
    )
    let result = SupatermNewTabResult(
      isFocused: false,
      isSelectedSpace: false,
      isSelectedTab: false,
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 1,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )

    let request = try SupatermSocketRequest.newTab(requestPayload, id: "new-tab-1")
    let response = try SupatermSocketResponse.ok(id: "new-tab-1", encodableResult: result)

    #expect(request.method == SupatermSocketMethod.terminalNewTab)
    #expect(try request.decodeParams(SupatermNewTabRequest.self) == requestPayload)
    #expect(try response.decodeResult(SupatermNewTabResult.self) == result)
  }

  @Test
  func newPaneRequestAndResponseRoundTripThroughTypedHelpers() throws {
    let requestPayload = SupatermNewPaneRequest(
      command: "pwd",
      direction: .down,
      focus: false,
      equalize: false,
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
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 1,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 3,
      paneID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
    )

    let request = try SupatermSocketRequest.newPane(requestPayload, id: "new-pane-1")
    let response = try SupatermSocketResponse.ok(id: "new-pane-1", encodableResult: result)

    #expect(request.method == SupatermSocketMethod.terminalNewPane)
    #expect(try request.decodeParams(SupatermNewPaneRequest.self) == requestPayload)
    #expect(try response.decodeResult(SupatermNewPaneResult.self) == result)
  }

  @Test
  func notifyRequestAndResponseRoundTripThroughTypedHelpers() throws {
    let requestPayload = SupatermNotifyRequest(
      body: "Build finished",
      subtitle: "CI",
      targetPaneIndex: 2,
      targetSpaceIndex: 2,
      targetTabIndex: 1,
      targetWindowIndex: 1,
      title: "Deploy complete"
    )
    let result = SupatermNotifyResult(
      attentionState: .unread,
      desktopNotificationDisposition: .deliver,
      resolvedTitle: "Deploy complete",
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 1,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 2,
      paneID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
    )

    let request = try SupatermSocketRequest.notify(requestPayload, id: "notify-1")
    let response = try SupatermSocketResponse.ok(id: "notify-1", encodableResult: result)

    #expect(request.method == SupatermSocketMethod.terminalNotify)
    #expect(try request.decodeParams(SupatermNotifyRequest.self) == requestPayload)
    #expect(try response.decodeResult(SupatermNotifyResult.self) == result)
  }

  @Test
  func notifyRequestDecodingPreservesMissingTitle() throws {
    let request = SupatermSocketRequest(
      id: "notify-default-title",
      method: SupatermSocketMethod.terminalNotify,
      params: [
        "body": "Build finished",
        "targetSpaceIndex": 1,
        "targetTabIndex": 2,
      ]
    )

    #expect(
      try request.decodeParams(SupatermNotifyRequest.self)
        == .init(
          body: "Build finished",
          targetSpaceIndex: 1,
          targetTabIndex: 2
        )
    )
  }

  @Test
  func agentHookRequestRoundTripsTypedPayload() throws {
    let event = try ClaudeHookFixtures.event(ClaudeHookFixtures.preToolUse)
    let requestPayload = SupatermAgentHookRequest(
      agent: .claude,
      context: .init(
        surfaceID: UUID(uuidString: "BA864E81-56B8-4610-B8E1-9E3D0F16DEEF")!,
        tabID: UUID(uuidString: "0FEF397C-128B-4BC7-A31B-1129AFB6B8EE")!
      ),
      event: event
    )

    let request = try SupatermSocketRequest.agentHook(requestPayload, id: "agent-hook-1")

    #expect(request.method == SupatermSocketMethod.terminalAgentHook)
    #expect(try request.decodeParams(SupatermAgentHookRequest.self) == requestPayload)
  }

  @Test
  func paneControlRequestsRoundTripThroughTypedHelpers() throws {
    let paneTarget = SupatermPaneTarget(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 4,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )
    let focusRequest = try SupatermSocketRequest.focusPane(
      .init(
        targetWindowIndex: 1,
        targetSpaceIndex: 2,
        targetTabIndex: 3,
        targetPaneIndex: 4
      ),
      id: "focus-pane-1"
    )
    let focusResponse = try SupatermSocketResponse.ok(
      id: "focus-pane-1",
      encodableResult: SupatermFocusPaneResult(
        isFocused: true,
        isSelectedTab: true,
        target: paneTarget
      )
    )
    let sendTextRequest = try SupatermSocketRequest.sendText(
      .init(
        target: .init(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3,
          targetPaneIndex: 4
        ),
        text: "echo hello\n"
      ),
      id: "send-text-1"
    )
    let setPaneSizeRequest = try SupatermSocketRequest.setPaneSize(
      .init(
        amount: 30,
        axis: .horizontal,
        target: .init(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3,
          targetPaneIndex: 4
        ),
        unit: .percent
      ),
      id: "set-pane-size-1"
    )

    #expect(focusRequest.method == SupatermSocketMethod.terminalFocusPane)
    #expect(
      try focusRequest.decodeParams(SupatermPaneTargetRequest.self)
        == .init(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3,
          targetPaneIndex: 4
        )
    )
    #expect(try focusResponse.decodeResult(SupatermFocusPaneResult.self).target == paneTarget)
    #expect(sendTextRequest.method == SupatermSocketMethod.terminalSendText)
    #expect(
      try sendTextRequest.decodeParams(SupatermSendTextRequest.self)
        == .init(
          target: .init(
            targetWindowIndex: 1,
            targetSpaceIndex: 2,
            targetTabIndex: 3,
            targetPaneIndex: 4
          ),
          text: "echo hello\n"
        )
    )
    #expect(setPaneSizeRequest.method == SupatermSocketMethod.terminalSetPaneSize)
    #expect(
      try setPaneSizeRequest.decodeParams(SupatermSetPaneSizeRequest.self)
        == .init(
          amount: 30,
          axis: .horizontal,
          target: .init(
            targetWindowIndex: 1,
            targetSpaceIndex: 2,
            targetTabIndex: 3,
            targetPaneIndex: 4
          ),
          unit: .percent
        )
    )
  }

  @Test
  func spaceAndLayoutRequestsRoundTripThroughTypedHelpers() throws {
    let createSpaceRequest = try SupatermSocketRequest.createSpace(
      .init(
        name: "Build",
        target: .init(targetWindowIndex: 1)
      ),
      id: "create-space-1"
    )
    let equalizeRequest = try SupatermSocketRequest.equalizePanes(
      .init(
        targetWindowIndex: 1,
        targetSpaceIndex: 2,
        targetTabIndex: 3
      ),
      id: "equalize-panes-1"
    )
    let tileRequest = try SupatermSocketRequest.tilePanes(
      .init(
        targetWindowIndex: 4,
        targetSpaceIndex: 5,
        targetTabIndex: 6
      ),
      id: "tile-panes-1"
    )
    let mainVerticalRequest = try SupatermSocketRequest.mainVerticalPanes(
      .init(
        targetWindowIndex: 7,
        targetSpaceIndex: 8,
        targetTabIndex: 9
      ),
      id: "main-vertical-panes-1"
    )

    #expect(createSpaceRequest.method == SupatermSocketMethod.terminalCreateSpace)
    #expect(
      try createSpaceRequest.decodeParams(SupatermCreateSpaceRequest.self)
        == .init(
          name: "Build",
          target: .init(targetWindowIndex: 1)
        )
    )
    #expect(equalizeRequest.method == SupatermSocketMethod.terminalEqualizePanes)
    #expect(
      try equalizeRequest.decodeParams(SupatermTabTargetRequest.self)
        == .init(
          targetWindowIndex: 1,
          targetSpaceIndex: 2,
          targetTabIndex: 3
        )
    )
    #expect(tileRequest.method == SupatermSocketMethod.terminalTilePanes)
    #expect(
      try tileRequest.decodeParams(SupatermTabTargetRequest.self)
        == .init(
          targetWindowIndex: 4,
          targetSpaceIndex: 5,
          targetTabIndex: 6
        )
    )
    #expect(mainVerticalRequest.method == SupatermSocketMethod.terminalMainVerticalPanes)
    #expect(
      try mainVerticalRequest.decodeParams(SupatermTabTargetRequest.self)
        == .init(
          targetWindowIndex: 7,
          targetSpaceIndex: 8,
          targetTabIndex: 9
        )
    )
  }

  @Test
  func sendKeyRequestRoundTripsThroughTypedHelper() throws {
    let request = try SupatermSocketRequest.sendKey(
      .init(
        key: .enter,
        target: .init(
          targetWindowIndex: 7,
          targetSpaceIndex: 8,
          targetTabIndex: 9,
          targetPaneIndex: 10
        )
      ),
      id: "send-key-1"
    )

    #expect(request.method == SupatermSocketMethod.terminalSendKey)
    #expect(
      try request.decodeParams(SupatermSendKeyRequest.self)
        == .init(
          key: .enter,
          target: .init(
            targetWindowIndex: 7,
            targetSpaceIndex: 8,
            targetTabIndex: 9,
            targetPaneIndex: 10
          )
        )
    )
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

private func makeSocketProtocolTemporaryDirectory() throws -> URL {
  var template = Array("/tmp/stm.XXXXXX".utf8CString)
  guard let pointer = mkdtemp(&template) else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  let path = SupatermSocketPath.canonicalized(String(cString: pointer)) ?? String(cString: pointer)
  return URL(fileURLWithPath: path, isDirectory: true)
}

private func createSocketNode(at url: URL) throws {
  _ = url.path.withCString(unlink)

  let socketDescriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  guard socketDescriptor >= 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  defer { Darwin.close(socketDescriptor) }

  var address = sockaddr_un()
  memset(&address, 0, MemoryLayout<sockaddr_un>.size)
  address.sun_family = sa_family_t(AF_UNIX)

  let path = url.path
  let maxLength = MemoryLayout.size(ofValue: address.sun_path)
  guard path.utf8.count < maxLength else {
    throw POSIXError(.ENAMETOOLONG)
  }

  path.withCString { pointer in
    withUnsafeMutablePointer(to: &address.sun_path) { pathPointer in
      let buffer = UnsafeMutableRawPointer(pathPointer).assumingMemoryBound(to: CChar.self)
      strncpy(buffer, pointer, maxLength - 1)
    }
  }

  let bindResult = withUnsafePointer(to: &address) { pointer in
    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
      Darwin.bind(socketDescriptor, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
  }
  guard bindResult == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}
