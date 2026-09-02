import AppKit
import GhosttyKit
import SupatermCLIShared
import SupatermHostClient
import SupatermSupport

@MainActor
final class HostWorkspaceApplicationController {
  private let ghosttyRuntime: GhosttyRuntime
  private let clientID: HostClientID
  private var runtime: HostClientRuntime?
  private var notificationDelivery: HostNotificationDelivery?

  init(ghosttyRuntime: GhosttyRuntime, clientID: HostClientID = HostClientIdentity.load()) {
    self.ghosttyRuntime = ghosttyRuntime
    self.clientID = clientID
  }

  func start() async throws {
    guard runtime == nil else { return }
    let connection = try await HostProcessBootstrap.bundled().connection(
      clientID: clientID,
      capabilities: [
        "semantic_state",
        "terminal_snapshot",
        "native_focus",
        "native_screenshot",
        "native_clipboard",
        "native_open_url",
        "native_notification",
        "native_client_shutdown",
      ],
      capabilityHandler: { [weak self] request in
        guard let self else {
          throw HostProtocolError(code: .capabilityUnavailable)
        }
        return try await self.handle(request)
      }
    )
    let ghosttyRuntime = ghosttyRuntime
    let clientID = clientID
    let reconciler = HostWindowReconciler { windowID in
      HostWorkspaceWindowPresentation(
        windowID: windowID,
        connection: connection,
        ghosttyRuntime: ghosttyRuntime,
        clientID: clientID
      )
    }
    let runtime = HostClientRuntime(connection: connection, windows: reconciler)
    let notificationDelivery = HostNotificationDelivery(connection: connection)
    runtime.onProjectionChange = { [weak notificationDelivery] _ in
      notificationDelivery?.drain()
    }
    self.notificationDelivery = notificationDelivery
    self.runtime = runtime
    runtime.start()
    try await ensureInitialTab()
  }

  func stop() {
    notificationDelivery?.stop()
    notificationDelivery = nil
    runtime?.stop()
    runtime = nil
  }

  func createWindow(workingDirectory: String? = nil) async throws {
    guard let runtime, let state = runtime.projection.state,
      let spaceID = state.workspace.spaces.first?.id
    else {
      throw HostWorkspacePresentationError.notReady
    }
    let windowID = HostWindowID()
    let added = try await runtime.connection.apply(
      command: .addWindow(windowID: windowID),
      expectedStructureRevision: state.structureRevision
    )
    try await createTab(
      windowID: windowID,
      spaceID: spaceID,
      structureRevision: added.structureRevision,
      workingDirectory: workingDirectory
    )
  }

  func createTab(workingDirectory: String? = nil) async throws {
    guard let runtime, let state = runtime.projection.state, let client = state.clientState else {
      throw HostWorkspacePresentationError.notReady
    }
    let windowID = client.activeWindowID ?? client.windowOrder.first
    guard let windowID, let window = client.window(windowID) else {
      throw HostWorkspacePresentationError.notReady
    }
    try await createTab(
      windowID: windowID,
      spaceID: window.displayedSpaceID,
      structureRevision: state.structureRevision,
      workingDirectory: workingDirectory
    )
  }

  func showExistingWindow() -> Bool {
    guard let runtime, let client = runtime.projection.state?.clientState else { return false }
    for windowID in client.windowOrder {
      guard let window = client.window(windowID), window.isOpen else { continue }
      if let nativeWindow = NSApp.windows.first(where: {
        $0.identifier?.rawValue.hasSuffix(windowID.uuidString) == true
      }) {
        if nativeWindow.isMiniaturized {
          nativeWindow.deminiaturize(nil)
        }
        nativeWindow.makeKeyAndOrderFront(nil)
        return true
      }
    }
    return false
  }

  func closeAllWindows() -> Bool {
    let windows = NSApp.windows.filter {
      $0.identifier?.rawValue.contains(".host-window.") == true
    }
    for window in windows {
      window.performClose(nil)
    }
    return !windows.isEmpty
  }

  func terminateAll() async throws {
    guard let runtime else { throw HostWorkspacePresentationError.notReady }
    _ = try await runtime.connection.request(
      method: "host.terminate_all",
      params: HostTerminateAllRequest(confirmed: true),
      as: HostTerminateAllResult.self
    )
  }

  func licenseStatus() async throws -> HostLicenseStatus {
    guard let runtime else { throw HostWorkspacePresentationError.notReady }
    return try await runtime.connection.request(
      method: "license.status",
      params: HostJSONValue.null
    )
  }

  func activateLicense(_ key: String) async throws -> HostLicenseStatus {
    guard let runtime else { throw HostWorkspacePresentationError.notReady }
    return try await runtime.connection.request(
      method: "license.activate",
      params: HostLicenseActivationRequest(key: key)
    )
  }

  func deactivateLicense() async throws -> HostLicenseStatus {
    guard let runtime else { throw HostWorkspacePresentationError.notReady }
    return try await runtime.connection.request(
      method: "license.deactivate",
      params: HostJSONValue.null
    )
  }

  func refreshLicense() async throws -> HostLicenseStatus {
    guard let runtime else { throw HostWorkspacePresentationError.notReady }
    return try await runtime.connection.request(
      method: "license.refresh",
      params: HostJSONValue.null
    )
  }

  func licenseURL(renew: Bool) async throws -> URL {
    guard let runtime else { throw HostWorkspacePresentationError.notReady }
    let response: HostURLResponse = try await runtime.connection.request(
      method: renew ? "license.renew" : "license.buy",
      params: HostJSONValue.null
    )
    guard let url = URL(string: response.url) else {
      throw HostWorkspacePresentationError.invalidURL
    }
    return url
  }

  func settings() async throws -> [String: HostJSONValue] {
    guard let runtime else { throw HostWorkspacePresentationError.notReady }
    return try await runtime.connection.request(
      method: "settings.list",
      params: HostJSONValue.null
    )
  }

  func setSetting(_ key: String, value: HostJSONValue) async throws -> [String: HostJSONValue] {
    guard let runtime else { throw HostWorkspacePresentationError.notReady }
    return try await runtime.connection.request(
      method: "settings.set",
      params: HostSettingRequest(key: key, value: value)
    )
  }

  func integration(method: String, kind: String) async throws -> HostJSONValue {
    guard let runtime else { throw HostWorkspacePresentationError.notReady }
    return try await runtime.connection.request(
      method: method,
      params: HostIntegrationRequest(kind: kind)
    )
  }

  func refreshNotificationDelivery() {
    if HostClientPreferences.systemNotificationsEnabled {
      notificationDelivery?.drain()
    } else {
      notificationDelivery?.stop()
    }
  }

  func focus(paneID: HostPaneID) async throws {
    guard let runtime, let state = runtime.projection.state else {
      throw HostWorkspacePresentationError.notReady
    }
    guard let location = state.workspace.location(of: paneID) else {
      throw HostWorkspacePresentationError.notFound
    }
    let commands: [HostWorkspaceCommand] = [
      .selectSpace(
        clientID: clientID,
        windowID: location.windowID,
        spaceID: location.spaceID
      ),
      .selectTab(
        clientID: clientID,
        windowID: location.windowID,
        spaceID: location.spaceID,
        tabID: location.tabID
      ),
      .focusPane(
        clientID: clientID,
        windowID: location.windowID,
        spaceID: location.spaceID,
        tabID: location.tabID,
        paneID: paneID
      ),
      .setActiveWindow(clientID: clientID, windowID: location.windowID),
    ]
    for command in commands {
      _ = try await runtime.connection.apply(
        command: command,
        expectedStructureRevision: nil
      )
    }
    try raise(paneID: paneID)
  }

  private func handle(_ request: HostCapabilityRequest) async throws -> HostJSONValue {
    switch request.method {
    case "native.focus":
      let params = try request.params.decode(HostNativePaneRequest.self)
      try raise(paneID: params.paneID)
      return .object(["focused": .bool(true)])
    case "native.screenshot":
      let params = try request.params.decode(HostNativeScreenshotRequest.self)
      let path = try screenshot(paneID: params.paneID, outputPath: params.outputPath)
      return try HostJSONValue.encode(HostNativeScreenshotResponse(path: path))
    case "native.clipboard.read":
      return .object([
        "text": .string(NSPasteboard.general.string(forType: .string) ?? "")
      ])
    case "native.clipboard.write":
      let params = try request.params.decode(HostNativeClipboardWriteRequest.self)
      NSPasteboard.general.clearContents()
      guard NSPasteboard.general.setString(params.text, forType: .string) else {
        throw HostProtocolError(code: .internal)
      }
      return .object(["written": .bool(true)])
    case "native.open_url":
      let params = try request.params.decode(HostNativeURLRequest.self)
      try openURL(params.url)
      return .object(["accepted": .bool(true)])
    case "native.notification":
      let params = try request.params.decode(HostNativeNotificationRequest.self)
      await DesktopNotificationClient.liveValue.deliver(
        NotificationRequest(
          body: params.body ?? "",
          disposition: .deliver,
          subtitle: params.subtitle ?? "",
          title: params.title ?? "Supaterm",
          sourceSurfaceID: params.paneID
        )
      )
      return .object(["delivered": .bool(true)])
    case "native.client_shutdown":
      let params = try request.params.decode(HostNativeShutdownRequest.self)
      guard params.confirmed else {
        throw HostProtocolError(code: .confirmationRequired)
      }
      DispatchQueue.main.async {
        NSApp.terminate(nil)
      }
      return .object(["accepted": .bool(true)])
    default:
      throw HostProtocolError(code: .capabilityUnavailable)
    }
  }

  private func raise(paneID: HostPaneID) throws {
    guard let runtime, let state = runtime.projection.state,
      let location = state.workspace.location(of: paneID),
      let presentation = runtime.presentation(for: location.windowID)
        as? HostWorkspaceWindowPresentation
    else {
      throw HostProtocolError(code: .capabilityUnavailable)
    }
    presentation.raise()
  }

  private func screenshot(paneID: HostPaneID, outputPath: String) throws -> String {
    guard let runtime, let state = runtime.projection.state,
      let location = state.workspace.location(of: paneID),
      let presentation = runtime.presentation(for: location.windowID)
        as? HostWorkspaceWindowPresentation
    else {
      throw HostProtocolError(code: .capabilityUnavailable)
    }
    return try presentation.screenshot(paneID: paneID, outputPath: outputPath)
  }

  private func openURL(_ value: String) throws {
    let target = GhosttyUntrustedURL(value)
    switch target.decision {
    case .allow(let url):
      guard NSWorkspace.shared.open(url) else { throw HostProtocolError(code: .internal) }
    case .confirm(let url):
      GhosttyUntrustedURLAlert.presentConfirmation(for: url, displayString: target.displayString)
    case .deny(let reason):
      GhosttyUntrustedURLAlert.presentBlock(reason: reason, displayString: target.displayString)
      throw HostProtocolError(code: .permissionDenied)
    }
  }

  private func ensureInitialTab() async throws {
    for _ in 0..<200 {
      if let runtime, let state = runtime.projection.state,
        let client = state.clientState,
        let windowID = client.activeWindowID ?? client.windowOrder.first,
        let windowState = client.window(windowID)
      {
        let hasTab = state.workspace.windows.values.contains { window in
          window.spaces.values.contains { !$0.tabs.isEmpty }
        }
        if !hasTab {
          try await createTab(
            windowID: windowID,
            spaceID: windowState.displayedSpaceID,
            structureRevision: state.structureRevision,
            workingDirectory: nil
          )
        }
        return
      }
      try await Task.sleep(for: .milliseconds(25))
    }
    throw HostWorkspacePresentationError.notReady
  }

  private func createTab(
    windowID: HostWindowID,
    spaceID: HostSpaceID,
    structureRevision: UInt64,
    workingDirectory: String?
  ) async throws {
    guard let runtime else { throw HostWorkspacePresentationError.notReady }
    let tabID = HostTabID()
    let paneID = HostPaneID()
    let index =
      runtime.projection.state?.workspace.window(windowID)?.content(spaceID)?
      .regularRoots.count ?? 0
    _ = try await runtime.connection.apply(
      command: .createTab(
        windowID: windowID,
        spaceID: spaceID,
        tabID: tabID,
        paneID: paneID,
        placement: .root(pinned: false, index: index),
        title: nil,
        restartDirectory: workingDirectory
      ),
      expectedStructureRevision: structureRevision,
      spawnSpecs: [
        paneID.uuidString.lowercased(): HostSpawnSpec(
          cwd: workingDirectory,
          rows: 24,
          columns: 80,
          pixelWidth: 960,
          pixelHeight: 600
        )
      ]
    )
  }
}

@MainActor
private final class HostNotificationDelivery {
  private let connection: HostConnection
  private var leaseID: UUID?
  private var task: Task<Void, Never>?

  init(connection: HostConnection) {
    self.connection = connection
  }

  func drain() {
    guard HostClientPreferences.systemNotificationsEnabled else { return }
    guard task == nil else { return }
    task = Task { [weak self] in
      guard let self else { return }
      defer { task = nil }
      do {
        let leaseID = try await lease()
        while let notification: HostNotificationRecord = try await connection.request(
          method: "notification.next",
          params: HostNotificationLeaseRequest(leaseID: leaseID)
        ) {
          await DesktopNotificationClient.liveValue.deliver(
            NotificationRequest(
              body: notification.body ?? "",
              disposition: .deliver,
              subtitle: "",
              title: notification.title ?? "Supaterm",
              sourceSurfaceID: notification.paneID
            )
          )
          _ = try await connection.request(
            method: "notification.ack",
            params: HostNotificationAckRequest(
              leaseID: leaseID,
              notificationID: notification.id
            ),
            as: HostAcknowledgement.self
          )
        }
      } catch {
        leaseID = nil
      }
    }
  }

  func stop() {
    task?.cancel()
    task = nil
    guard let leaseID else { return }
    self.leaseID = nil
    Task {
      _ = try? await connection.request(
        method: "notification.release_sink",
        params: HostNotificationLeaseRequest(leaseID: leaseID),
        as: HostReleaseResult.self
      )
    }
  }

  private func lease() async throws -> UUID {
    if let leaseID { return leaseID }
    let grant: HostNotificationLeaseGrant = try await connection.request(
      method: "notification.claim_sink",
      params: HostJSONValue.null
    )
    leaseID = grant.leaseID
    return grant.leaseID
  }
}

@MainActor
private final class HostWorkspaceWindowPresentation: NSObject, HostWindowPresentation,
  NSWindowDelegate
{
  private let windowID: HostWindowID
  private let connection: HostConnection
  private let clientID: HostClientID
  private let contentView: HostWorkspaceContentView
  private let windowController: NSWindowController
  private var approvedClose = false
  private var detaching = false
  private var appliedPlacement = false
  private var placementTask: Task<Void, Never>?

  init(
    windowID: HostWindowID,
    connection: HostConnection,
    ghosttyRuntime: GhosttyRuntime,
    clientID: HostClientID
  ) {
    self.windowID = windowID
    self.connection = connection
    self.clientID = clientID
    contentView = HostWorkspaceContentView(
      connection: connection,
      ghosttyRuntime: ghosttyRuntime,
      clientID: clientID,
      windowID: windowID
    )
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1_440, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.contentView = contentView
    window.contentMinSize = NSSize(width: 720, height: 480)
    window.identifier = NSUserInterfaceItemIdentifier(
      "\(Bundle.main.bundleIdentifier ?? "app.supabit.supaterm").host-window.\(windowID.uuidString)"
    )
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    windowController = NSWindowController(window: window)
    super.init()
    window.delegate = self
  }

  func update(
    window: HostWindow,
    clientState: HostClientWindowState,
    projection: HostProjectionState
  ) {
    contentView.update(window: window, clientState: clientState, projection: projection)
    let nativeWindow = windowController.window
    if !appliedPlacement, let placement = clientState.platformPlacement,
      placement.platform == "macos"
    {
      appliedPlacement = true
      nativeWindow?.setFrame(
        NSRect(
          x: Int(placement.x),
          y: Int(placement.y),
          width: Int(placement.width),
          height: Int(placement.height)
        ),
        display: false
      )
    }
    if clientState.isOpen, nativeWindow?.isVisible != true {
      nativeWindow?.makeKeyAndOrderFront(nil)
    }
  }

  func detach() {
    detaching = true
    placementTask?.cancel()
    contentView.detach()
    windowController.close()
  }

  func raise() {
    NSApp.activate(ignoringOtherApps: true)
    windowController.window?.makeKeyAndOrderFront(nil)
  }

  func screenshot(paneID: HostPaneID, outputPath: String) throws -> String {
    try contentView.screenshot(paneID: paneID, outputPath: outputPath)
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if detaching || approvedClose { return true }
    Task { [weak self, weak sender] in
      guard let self, let sender else { return }
      do {
        let command = HostWorkspaceCommand.closeWindow(windowID: windowID)
        let confirmation: HostCloseConfirmation = try await connection.request(
          method: "workspace.prepare_close",
          params: HostPrepareCloseRequest(command: command)
        )
        guard confirmation.processes.isEmpty || confirmClose(sender, count: confirmation.processes.count)
        else { return }
        _ = try await connection.apply(
          command: command,
          expectedStructureRevision: confirmation.structureRevision,
          confirmationTokens: confirmation.tokens
        )
        approvedClose = true
        sender.close()
      } catch {
        present(error, on: sender)
      }
    }
    return false
  }

  func windowDidBecomeKey(_ notification: Notification) {
    Task {
      _ = try? await connection.apply(
        command: .setActiveWindow(clientID: clientID, windowID: windowID),
        expectedStructureRevision: nil
      )
    }
  }

  func windowDidMove(_ notification: Notification) {
    savePlacement()
  }

  func windowDidResize(_ notification: Notification) {
    savePlacement()
  }

  func windowWillClose(_ notification: Notification) {
    placementTask?.cancel()
    contentView.detach()
  }

  private func savePlacement() {
    guard appliedPlacement, let window = windowController.window else { return }
    placementTask?.cancel()
    let frame = window.frame
    let placement = HostPlatformWindowPlacement(
      platform: "macos",
      x: Int32(clamping: Int(frame.origin.x.rounded())),
      y: Int32(clamping: Int(frame.origin.y.rounded())),
      width: UInt32(clamping: Int(frame.width.rounded())),
      height: UInt32(clamping: Int(frame.height.rounded())),
      displayID: window.screen?.localizedName
    )
    placementTask = Task { [weak self] in
      try? await Task.sleep(for: .milliseconds(150))
      guard let self, !Task.isCancelled else { return }
      _ = try? await connection.apply(
        command: .setPlatformPlacement(
          clientID: clientID,
          windowID: windowID,
          placement: placement
        ),
        expectedStructureRevision: nil
      )
    }
  }

  private func confirmClose(_ window: NSWindow, count: Int) -> Bool {
    let alert = NSAlert()
    alert.messageText = count == 1 ? "Close this terminal?" : "Close these terminals?"
    alert.informativeText = "This will end \(count) running process\(count == 1 ? "" : "es")."
    alert.addButton(withTitle: "Close")
    alert.addButton(withTitle: "Cancel")
    return alert.runModal() == .alertFirstButtonReturn
  }

  private func present(_ error: any Error, on window: NSWindow) {
    let alert = NSAlert(error: error)
    alert.beginSheetModal(for: window)
  }
}

@MainActor
private final class HostWorkspaceContentView: NSView {
  private let connection: HostConnection
  private let ghosttyRuntime: GhosttyRuntime
  private let clientID: HostClientID
  private let windowID: HostWindowID
  private let sidebar = NSStackView()
  private let detail = NSView()
  private let agentPanel = NSTextField(wrappingLabelWithString: "")
  private var renderers: [HostPaneID: HostPaneRenderer] = [:]
  private var treeView: NSView?
  private var enrichmentPaneID: HostPaneID?
  private var enrichmentSubscriptionID: UUID?
  private var enrichmentTask: Task<Void, Never>?
  private var structureRevision: UInt64?
  private var sidebarWidth: CGFloat = 240

  init(
    connection: HostConnection,
    ghosttyRuntime: GhosttyRuntime,
    clientID: HostClientID,
    windowID: HostWindowID
  ) {
    self.connection = connection
    self.ghosttyRuntime = ghosttyRuntime
    self.clientID = clientID
    self.windowID = windowID
    super.init(frame: .zero)
    wantsLayer = true
    layer?.backgroundColor = NSColor.windowBackgroundColor.cgColor
    sidebar.orientation = .vertical
    sidebar.alignment = .leading
    sidebar.spacing = 4
    sidebar.edgeInsets = NSEdgeInsets(top: 42, left: 12, bottom: 12, right: 12)
    addSubview(sidebar)
    addSubview(detail)
    agentPanel.isHidden = true
    agentPanel.font = .systemFont(ofSize: 12)
    agentPanel.textColor = .secondaryLabelColor
    agentPanel.drawsBackground = true
    agentPanel.backgroundColor = .controlBackgroundColor
    detail.addSubview(agentPanel)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func layout() {
    super.layout()
    let width = sidebar.isHidden ? 0 : min(sidebarWidth, bounds.width * 0.45)
    sidebar.frame = NSRect(x: 0, y: 0, width: width, height: bounds.height)
    detail.frame = NSRect(x: width, y: 0, width: bounds.width - width, height: bounds.height)
    let panelWidth: CGFloat = agentPanel.isHidden ? 0 : min(320, detail.bounds.width * 0.35)
    treeView?.frame = NSRect(
      x: 0,
      y: 0,
      width: detail.bounds.width - panelWidth,
      height: detail.bounds.height
    )
    agentPanel.frame = NSRect(
      x: detail.bounds.width - panelWidth,
      y: 0,
      width: panelWidth,
      height: detail.bounds.height
    )
  }

  func update(
    window: HostWindow,
    clientState: HostClientWindowState,
    projection: HostProjectionState
  ) {
    structureRevision = projection.structureRevision
    sidebar.isHidden = clientState.sidebarCollapsed
    sidebarWidth = CGFloat(clientState.sidebarWidth ?? 240)
    let spaceID = clientState.displayedSpaceID
    guard let content = window.content(spaceID) else {
      showEmpty()
      return
    }
    rebuildSidebar(
      window: window,
      content: content,
      clientState: clientState,
      projection: projection
    )
    guard let tabID = clientState.selectedTab(spaceID), let tab = content.tab(tabID) else {
      showEmpty()
      return
    }
    let visibleRoot =
      clientState.zoomedPane(tabID).map {
        HostSplitNode.pane(paneID: $0, restartDirectory: nil)
      } ?? tab.root
    let desired = Set(visibleRoot.paneIDs)
    removeRenderers(except: desired)
    for paneID in desired where renderers[paneID] == nil {
      renderers[paneID] = HostPaneRenderer(
        connection: connection,
        runtime: ghosttyRuntime,
        paneID: paneID
      )
    }
    let tree = makeTree(visibleRoot)
    treeView?.removeFromSuperview()
    treeView = tree
    tree.autoresizingMask = [.width, .height]
    detail.addSubview(tree)
    let focused = clientState.focusedPane(tabID) ?? visibleRoot.paneIDs.first
    updateAgentPanel(
      paneID: focused,
      hidden: focused.map(clientState.hiddenAgentPanels.contains) ?? false,
      projection: projection
    )
    if let focused, let view = renderers[focused]?.view {
      windowControllerWindow?.makeFirstResponder(view)
    }
    needsLayout = true
  }

  func detach() {
    stopEnrichment()
    removeRenderers(except: [])
  }

  func screenshot(paneID: HostPaneID, outputPath: String) throws -> String {
    guard let view = renderers[paneID]?.view,
      let image = TerminalPaneCaptureClient.live.capture(view),
      let data = NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])
    else {
      throw HostProtocolError(code: .capabilityUnavailable)
    }
    let url = URL(fileURLWithPath: outputPath).standardizedFileURL
    try data.write(to: url, options: .atomic)
    return url.path
  }

  private var windowControllerWindow: NSWindow? {
    window
  }

  private func rebuildSidebar(
    window: HostWindow,
    content: HostSpaceContent,
    clientState: HostClientWindowState,
    projection: HostProjectionState
  ) {
    sidebar.arrangedSubviews.forEach {
      sidebar.removeArrangedSubview($0)
      $0.removeFromSuperview()
    }
    for space in projection.workspace.spaces {
      let button = HostActionButton(title: space.name) { [weak self] in
        guard let self else { return }
        apply(.selectSpace(clientID: clientID, windowID: window.id, spaceID: space.id))
      }
      button.state = space.id == clientState.displayedSpaceID ? .on : .off
      sidebar.addArrangedSubview(button)
    }
    sidebar.addArrangedSubview(separator())
    let collapsed = clientState.collapsedGroups(clientState.displayedSpaceID)
    for item in content.pinnedRoots + content.regularRoots {
      switch item {
      case .tab(let tabID):
        addTab(tabID, content: content, clientState: clientState, projection: projection)
      case .group(let groupID):
        guard let group = content.group(groupID) else { continue }
        let button = HostActionButton(title: group.title) { [weak self] in
          guard let self else { return }
          apply(
            .setGroupCollapsed(
              clientID: clientID,
              windowID: window.id,
              spaceID: clientState.displayedSpaceID,
              groupID: groupID,
              collapsed: !collapsed.contains(groupID)
            )
          )
        }
        button.font = .systemFont(ofSize: 12, weight: .semibold)
        sidebar.addArrangedSubview(button)
        if !collapsed.contains(groupID) {
          for tabID in group.tabs {
            addTab(tabID, content: content, clientState: clientState, projection: projection)
          }
        }
      }
    }
    let newTab = HostActionButton(title: "+ New Tab") { [weak self] in
      self?.createTab(in: content, spaceID: clientState.displayedSpaceID)
    }
    sidebar.addArrangedSubview(newTab)
    if let tabID = clientState.selectedTab(clientState.displayedSpaceID),
      let tab = content.tab(tabID),
      let paneID = clientState.focusedPane(tabID) ?? tab.root.paneIDs.first,
      projection.agent(paneID) != nil
    {
      let hidden = clientState.hiddenAgentPanels.contains(paneID)
      let panel = HostActionButton(title: hidden ? "Show agent panel" : "Hide agent panel") {
        [weak self] in
        guard let self else { return }
        apply(
          .setAgentPanelHidden(
            clientID: clientID,
            windowID: windowID,
            paneID: paneID,
            hidden: !hidden
          )
        )
      }
      sidebar.addArrangedSubview(panel)
    }
  }

  private func addTab(
    _ tabID: HostTabID,
    content: HostSpaceContent,
    clientState: HostClientWindowState,
    projection: HostProjectionState
  ) {
    guard let tab = content.tab(tabID) else { return }
    let selected = clientState.selectedTab(clientState.displayedSpaceID) == tabID
    let paneID = clientState.focusedPane(tabID) ?? tab.root.paneIDs.first
    let title = tab.title ?? paneID.flatMap { projection.pane($0)?.title } ?? "Terminal"
    let button = HostActionButton(title: title) { [weak self] in
      guard let self else { return }
      apply(
        .selectTab(
          clientID: clientID,
          windowID: windowID,
          spaceID: clientState.displayedSpaceID,
          tabID: tabID
        )
      )
    }
    button.state = selected ? .on : .off
    sidebar.addArrangedSubview(button)
  }

  private func createTab(in content: HostSpaceContent, spaceID: HostSpaceID) {
    guard let structureRevision else { return }
    let tabID = HostTabID()
    let paneID = HostPaneID()
    Task {
      do {
        _ = try await connection.apply(
          command: .createTab(
            windowID: windowID,
            spaceID: spaceID,
            tabID: tabID,
            paneID: paneID,
            placement: .root(pinned: false, index: content.regularRoots.count),
            title: nil,
            restartDirectory: nil
          ),
          expectedStructureRevision: structureRevision,
          spawnSpecs: [
            paneID.uuidString.lowercased(): HostSpawnSpec(
              rows: 24,
              columns: 80,
              pixelWidth: 960,
              pixelHeight: 600
            )
          ]
        )
      } catch {
        present(error)
      }
    }
  }

  private func apply(_ command: HostWorkspaceCommand) {
    Task {
      do {
        _ = try await connection.apply(
          command: command,
          expectedStructureRevision: command.isStructural ? structureRevision : nil
        )
      } catch {
        present(error)
      }
    }
  }

  private func makeTree(_ node: HostSplitNode) -> NSView {
    switch node {
    case .pane(let paneID, _):
      return renderers[paneID]?.view ?? NSView()
    case .split(_, let direction, let ratioMillionths, let first, let second):
      let split = HostSplitContainer(
        direction: direction,
        ratio: CGFloat(ratioMillionths) / 1_000_000
      )
      split.addSubview(makeTree(first))
      split.addSubview(makeTree(second))
      return split
    }
  }

  private func removeRenderers(except desired: Set<HostPaneID>) {
    for paneID in renderers.keys where !desired.contains(paneID) {
      renderers.removeValue(forKey: paneID)?.stop()
    }
  }

  private func showEmpty() {
    stopEnrichment()
    removeRenderers(except: [])
    treeView?.removeFromSuperview()
    let label = NSTextField(labelWithString: "No terminal")
    label.alignment = .center
    label.frame = detail.bounds
    label.autoresizingMask = [.width, .height]
    detail.addSubview(label)
    treeView = label
    agentPanel.isHidden = true
  }

  private func updateAgentPanel(
    paneID: HostPaneID?,
    hidden: Bool,
    projection: HostProjectionState
  ) {
    guard let paneID, let agent = projection.agent(paneID), !hidden else {
      agentPanel.isHidden = true
      stopEnrichment()
      return
    }
    let enrichment = projection.enrichment(paneID)
    let repository =
      enrichment?.repository.map {
        "\n\n\($0.branch)\n+\($0.addedLines) −\($0.removedLines)"
      } ?? ""
    let ports = enrichment?.listeningEndpoints.map { String($0.port) }.joined(separator: ", ")
    let portText = ports.map { $0.isEmpty ? "" : "\n\nPorts: \($0)" } ?? ""
    agentPanel.stringValue = "\(agent.kind ?? "Agent")\n\(agent.phase.rawValue)\(repository)\(portText)"
    agentPanel.isHidden = false
    startEnrichment(paneID)
  }

  private func startEnrichment(_ paneID: HostPaneID) {
    guard enrichmentPaneID != paneID else { return }
    stopEnrichment()
    enrichmentPaneID = paneID
    enrichmentTask = Task { [weak self] in
      guard let self else { return }
      do {
        let grant: HostEnrichmentSubscriptionGrant = try await connection.request(
          method: "enrichment.subscribe",
          params: HostEnrichmentSubscribeRequest(paneID: paneID)
        )
        guard !Task.isCancelled else { return }
        enrichmentSubscriptionID = grant.subscriptionID
      } catch {
        enrichmentPaneID = nil
      }
    }
  }

  private func stopEnrichment() {
    enrichmentTask?.cancel()
    enrichmentTask = nil
    enrichmentPaneID = nil
    guard let subscriptionID = enrichmentSubscriptionID else { return }
    enrichmentSubscriptionID = nil
    Task {
      _ = try? await connection.request(
        method: "enrichment.unsubscribe",
        params: HostEnrichmentUnsubscribeRequest(subscriptionID: subscriptionID),
        as: HostUnsubscribeResult.self
      )
    }
  }

  private func separator() -> NSBox {
    let box = NSBox()
    box.boxType = .separator
    return box
  }

  private func present(_ error: any Error) {
    guard let window else { return }
    NSAlert(error: error).beginSheetModal(for: window)
  }
}

@MainActor
private final class HostPaneRenderer {
  let view: GhosttySurfaceView
  private let session: HostPaneRendererSession

  init(
    connection: HostConnection,
    runtime: GhosttyRuntime,
    paneID: HostPaneID
  ) {
    session = HostPaneRendererSession(connection: connection, paneID: paneID)
    view = GhosttySurfaceView(
      id: paneID,
      runtime: runtime,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      hostManagedSession: session.renderer
    )
    session.start()
  }

  func stop() {
    view.removeFromSuperview()
    view.closeSurface()
    Task { await session.stop() }
  }

  isolated deinit {
    let session = session
    Task { await session.stop() }
  }
}

@MainActor
private final class HostSplitContainer: NSView {
  private let direction: HostSplitDirection
  private let ratio: CGFloat

  init(direction: HostSplitDirection, ratio: CGFloat) {
    self.direction = direction
    self.ratio = ratio
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func layout() {
    super.layout()
    guard subviews.count == 2 else { return }
    let divider: CGFloat = 1
    switch direction {
    case .horizontal:
      let firstWidth = (bounds.width - divider) * ratio
      subviews[0].frame = NSRect(x: 0, y: 0, width: firstWidth, height: bounds.height)
      subviews[1].frame = NSRect(
        x: firstWidth + divider,
        y: 0,
        width: bounds.width - firstWidth - divider,
        height: bounds.height
      )
    case .vertical:
      let firstHeight = (bounds.height - divider) * ratio
      subviews[0].frame = NSRect(
        x: 0,
        y: bounds.height - firstHeight,
        width: bounds.width,
        height: firstHeight
      )
      subviews[1].frame = NSRect(
        x: 0,
        y: 0,
        width: bounds.width,
        height: bounds.height - firstHeight - divider
      )
    }
  }
}

@MainActor
private final class HostActionButton: NSButton {
  private let actionHandler: () -> Void

  init(title: String, action: @escaping () -> Void) {
    actionHandler = action
    super.init(frame: .zero)
    self.title = title
    target = self
    self.action = #selector(performAction)
    bezelStyle = .inline
    setButtonType(.toggle)
    alignment = .left
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  @objc private func performAction() {
    actionHandler()
  }
}

private nonisolated struct HostPrepareCloseRequest: Encodable, Sendable {
  let command: HostWorkspaceCommand
}

private nonisolated struct HostCloseConfirmation: Decodable, Sendable {
  let structureRevision: UInt64
  let processes: [String: UInt32]
  let tokens: [String: UUID]
}

private nonisolated struct HostNotificationLeaseGrant: Decodable, Sendable {
  let leaseID: UUID
  let afterAttentionRevision: UInt64
}

private nonisolated struct HostNotificationLeaseRequest: Encodable, Sendable {
  let leaseID: UUID
}

private nonisolated struct HostNotificationAckRequest: Encodable, Sendable {
  let leaseID: UUID
  let notificationID: UUID
}

private nonisolated struct HostAcknowledgement: Decodable, Sendable {
  let acknowledged: Bool
}

private nonisolated struct HostReleaseResult: Decodable, Sendable {
  let released: Bool
}

private nonisolated struct HostEnrichmentSubscribeRequest: Encodable, Sendable {
  let paneID: HostPaneID
}

private nonisolated struct HostEnrichmentSubscriptionGrant: Decodable, Sendable {
  let subscriptionID: UUID
  let enrichment: HostAgentEnrichment?
}

private nonisolated struct HostEnrichmentUnsubscribeRequest: Encodable, Sendable {
  let subscriptionID: UUID
}

private nonisolated struct HostUnsubscribeResult: Decodable, Sendable {
  let unsubscribed: Bool
}

nonisolated struct HostLicenseStatus: Decodable, Equatable, Sendable {
  enum Mode: String, Decodable, Sendable {
    case free
    case paid
    case expired
  }

  let mode: Mode
  let licenseID: String?
  let updatesThrough: String?
  let deviceName: String
  let openTabCount: Int
  let freeTabLimit: Int
}

private nonisolated struct HostLicenseActivationRequest: Encodable, Sendable {
  let key: String
}

private nonisolated struct HostURLResponse: Decodable, Sendable {
  let url: String
}

private nonisolated struct HostSettingRequest: Encodable, Sendable {
  let key: String
  let value: HostJSONValue
}

private nonisolated struct HostIntegrationRequest: Encodable, Sendable {
  let kind: String
}

private nonisolated struct HostTerminateAllRequest: Encodable, Sendable {
  let confirmed: Bool
}

private nonisolated struct HostTerminateAllResult: Decodable, Sendable {
  let terminatedPaneCount: Int
}

private nonisolated struct HostNativePaneRequest: Decodable, Sendable {
  let paneID: HostPaneID
}

private nonisolated struct HostNativeScreenshotRequest: Decodable, Sendable {
  let paneID: HostPaneID
  let outputPath: String
}

private nonisolated struct HostNativeScreenshotResponse: Encodable, Sendable {
  let path: String
}

private nonisolated struct HostNativeClipboardWriteRequest: Decodable, Sendable {
  let text: String
}

private nonisolated struct HostNativeURLRequest: Decodable, Sendable {
  let url: String
}

private nonisolated struct HostNativeNotificationRequest: Decodable, Sendable {
  let title: String?
  let subtitle: String?
  let body: String?
  let paneID: HostPaneID?
}

private nonisolated struct HostNativeShutdownRequest: Decodable, Sendable {
  let confirmed: Bool
}

private enum HostWorkspacePresentationError: Error {
  case invalidURL
  case notFound
  case notReady
}

private struct HostPaneLocation {
  let windowID: HostWindowID
  let spaceID: HostSpaceID
  let tabID: HostTabID
}

extension HostWorkspace {
  fileprivate func location(of paneID: HostPaneID) -> HostPaneLocation? {
    for window in windows.values {
      for (spaceKey, content) in window.spaces {
        guard let spaceID = UUID(uuidString: spaceKey) else { continue }
        for tab in content.tabs.values where tab.root.paneIDs.contains(paneID) {
          return HostPaneLocation(windowID: window.id, spaceID: spaceID, tabID: tab.id)
        }
      }
    }
    return nil
  }
}

extension HostProjectionState {
  fileprivate func pane(_ id: HostPaneID) -> HostPaneFacts? {
    paneFacts[id.uuidString.lowercased()] ?? paneFacts[id.uuidString.uppercased()]
  }

  fileprivate func agent(_ id: HostPaneID) -> HostAgentFact? {
    agentFacts[id.uuidString.lowercased()] ?? agentFacts[id.uuidString.uppercased()]
  }

  fileprivate func enrichment(_ id: HostPaneID) -> HostAgentEnrichment? {
    enrichments[id.uuidString.lowercased()] ?? enrichments[id.uuidString.uppercased()]
  }
}

extension HostWorkspaceCommand {
  fileprivate var isStructural: Bool {
    switch self {
    case .addSpace, .deleteSpace, .reorderSpace, .addWindow, .closeWindow, .createTab,
      .createGroup, .moveItems, .ungroup, .closeTab, .closeGroup, .splitPane, .closePane,
      .movePaneToTab, .movePaneToNewTab, .setSplitRatio, .tileTab, .mainVerticalTab,
      .detachToWindow, .mergeWindow:
      true
    case .renameSpace, .renameGroup, .renameTab, .selectSpace, .selectTab, .focusPane,
      .markAgentSeen, .markNotificationSeen, .setGroupCollapsed, .setActiveWindow,
      .reorderWindow, .setWindowOpen, .setZoomedPane, .setSidebar, .setAgentPanelHidden,
      .setPlatformPlacement:
      false
    }
  }
}
