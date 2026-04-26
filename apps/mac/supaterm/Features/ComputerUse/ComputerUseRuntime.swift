import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import Sharing
import SupatermCLIShared
import SupatermSupport

@_silgen_name("_AXUIElementGetWindow")
private func _AXUIElementGetWindow(
  _ element: AXUIElement,
  _ windowID: UnsafeMutablePointer<CGWindowID>
) -> AXError

@MainActor
public final class ComputerUseRuntime: @unchecked Sendable {
  public static let shared = ComputerUseRuntime()

  private struct CacheKey: Hashable {
    let pid: Int
    let windowID: UInt32
  }

  private let cursorOverlay = ComputerUseCursorOverlay()
  private let focusGuard = ComputerUseFocusGuard()
  private let launchFocusStealPreventer = ComputerUseSystemFocusStealPreventer()
  private var elementCache: [CacheKey: [Int: AXUIElement]] = [:]

  public init() {}

  public func permissions() async -> SupatermComputerUsePermissionsResult {
    let screenRecording = await screenRecordingGranted()
    return .init(
      accessibility: AXIsProcessTrusted() ? .granted : .missing,
      screenRecording: screenRecording ? .granted : .missing
    )
  }

  public func apps() -> SupatermComputerUseAppsResult {
    let apps = NSWorkspace.shared.runningApplications
      .filter { $0.activationPolicy == .regular }
      .map {
        SupatermComputerUseApp(
          pid: Int($0.processIdentifier),
          bundleID: $0.bundleIdentifier,
          name: $0.localizedName ?? $0.bundleIdentifier ?? String($0.processIdentifier),
          isActive: $0.isActive
        )
      }
      .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    return .init(apps: apps)
  }

  public func launch(
    _ request: SupatermComputerUseLaunchRequest
  ) async throws -> SupatermComputerUseLaunchResult {
    guard request.bundleID != nil || request.name != nil else {
      throw ComputerUseError.launchTargetRequired
    }
    let appURL = try applicationURL(bundleID: request.bundleID, name: request.name)
    let configuration = NSWorkspace.OpenConfiguration()
    configuration.activates = false
    configuration.addsToRecentItems = false
    configuration.createsNewApplicationInstance = request.createsNewInstance
    if !request.arguments.isEmpty {
      configuration.arguments = request.arguments
    }
    if !request.environment.isEmpty {
      var environment = ProcessInfo.processInfo.environment
      environment.merge(request.environment) { _, new in new }
      configuration.environment = environment
    }
    if let bundleID = Bundle(url: appURL)?.bundleIdentifier ?? request.bundleID {
      let target = NSAppleEventDescriptor(bundleIdentifier: bundleID)
      configuration.appleEvent = NSAppleEventDescriptor(
        eventClass: AEEventClass(kCoreEventClass),
        eventID: AEEventID(kAEOpenApplication),
        targetDescriptor: target,
        returnID: AEReturnID(kAutoGenerateReturnID),
        transactionID: AETransactionID(kAnyTransactionID)
      )
    }
    let previous = NSWorkspace.shared.frontmostApplication
    let previousRestoreTarget = previous.map { restoreTarget(for: $0) }
    let launchSuppression = previousRestoreTarget.flatMap {
      launchFocusStealPreventer.begin(targetPid: 0, restoreTo: $0)
    }
    let urls = try request.urls.map(launchURL)
    let app: NSRunningApplication
    do {
      app = try await withCheckedThrowingContinuation { continuation in
        let completion: @Sendable (NSRunningApplication?, Error?) -> Void = { app, error in
          if let error {
            continuation.resume(throwing: ComputerUseError.launchFailed(error.localizedDescription))
          } else if let app {
            continuation.resume(returning: app)
          } else {
            continuation.resume(throwing: ComputerUseError.launchFailed("LaunchServices returned no app."))
          }
        }
        if urls.isEmpty {
          NSWorkspace.shared.open(appURL, configuration: configuration, completionHandler: completion)
        } else {
          NSWorkspace.shared.open(
            urls,
            withApplicationAt: appURL,
            configuration: configuration,
            completionHandler: completion
          )
        }
      }
    } catch {
      if let launchSuppression {
        launchFocusStealPreventer.end(launchSuppression)
      }
      throw error
    }
    if let previousRestoreTarget, previous?.processIdentifier != app.processIdentifier {
      await suppressLaunchFocusSteal(
        target: app,
        restoreTo: previousRestoreTarget,
        placeholderSuppression: launchSuppression
      )
    } else if let launchSuppression {
      launchFocusStealPreventer.end(launchSuppression)
    }
    let windows = windows(.init(app: String(app.processIdentifier))).windows
    return .init(
      pid: Int(app.processIdentifier),
      bundleID: app.bundleIdentifier,
      name: app.localizedName ?? app.bundleIdentifier ?? String(app.processIdentifier),
      isActive: app.isActive,
      windows: windows
    )
  }

  public func windows(
    _ request: SupatermComputerUseWindowsRequest
  ) -> SupatermComputerUseWindowsResult {
    let pidFilter = pidFilter(for: request.app)
    let windows = windowInfos(onScreenOnly: request.onScreenOnly)
      .filter { info in
        guard let pidFilter else { return true }
        return info.pid == pidFilter
      }
      .map(\.window)
      .sorted {
        if $0.zIndex == $1.zIndex {
          return $0.id < $1.id
        }
        return $0.zIndex > $1.zIndex
      }
    return .init(windows: windows)
  }

  public func snapshot(
    _ request: SupatermComputerUseSnapshotRequest
  ) async throws -> SupatermComputerUseSnapshotResult {
    guard AXIsProcessTrusted() else {
      throw ComputerUseError.accessibilityPermissionMissing
    }

    let windowInfo = windowInfo(windowID: request.windowID, pid: request.pid)
    guard let windowInfo else {
      throw ComputerUseError.windowNotFound(request.windowID)
    }

    let mode = request.mode ?? currentSnapshotMode()
    let appElement = AXUIElementCreateApplication(pid_t(request.pid))
    focusGuard.prepareSnapshot(pid: pid_t(request.pid), app: appElement)
    var collection = ComputerUseElementCollection()
    if mode != .vision {
      collectElements(
        appElement,
        windowID: request.windowID,
        collection: &collection,
        depth: 0
      )
    }
    elementCache[.init(pid: request.pid, windowID: request.windowID)] = collection.cache
    let filteredElements = collection.elements.filter { elementMatchesQuery($0, query: request.query) }

    let screenshot =
      mode == .ax && request.imageOutputPath == nil
      ? nil
      : try await screenshot(windowID: request.windowID, outputPath: request.imageOutputPath)
    return .init(
      pid: request.pid,
      windowID: request.windowID,
      frame: windowInfo.window.frame,
      elements: filteredElements,
      screenshot: screenshot
    )
  }

  public func click(
    _ request: SupatermComputerUseClickRequest
  ) async throws -> SupatermComputerUseActionResult {
    if let elementIndex = request.elementIndex {
      let element = try cachedElement(
        pid: request.pid, windowID: request.windowID, elementIndex: elementIndex)
      return try await clickElement(element, request: request)
    }

    guard let x = request.x, let y = request.y else {
      throw ComputerUseError.invalidClickTarget
    }
    return try await postClick(
      point: try screenPoint(
        windowPixel: .init(x: x, y: y), pid: request.pid, windowID: request.windowID),
      request: request
    )
  }

  public func type(
    _ request: SupatermComputerUseTypeRequest
  ) throws -> SupatermComputerUseActionResult {
    if let elementIndex = request.elementIndex {
      guard let windowID = request.windowID else {
        throw ComputerUseError.snapshotRequired
      }
      let element = try cachedElement(pid: request.pid, windowID: windowID, elementIndex: elementIndex)
      do {
        try focusGuard.withFocusSuppressed(pid: pid_t(request.pid), element: element) {
          let result = AXUIElementSetAttributeValue(
            element,
            kAXSelectedTextAttribute as CFString,
            request.text as CFTypeRef
          )
          guard result == .success else {
            throw ComputerUseError.unsupportedBackgroundTarget
          }
        }
        return .init(ok: true, dispatch: "accessibility")
      } catch ComputerUseError.unsupportedBackgroundTarget {
        focusGuard.withFocusSuppressed(pid: pid_t(request.pid), element: element) {
          _ = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        }
      }
    }
    let dispatch = try ComputerUseKeyboardInput.type(
      text: request.text,
      delayMilliseconds: request.delayMilliseconds,
      pid: pid_t(request.pid)
    )
    return .init(ok: true, dispatch: dispatch.rawValue)
  }

  public func key(
    _ request: SupatermComputerUseKeyRequest
  ) throws -> SupatermComputerUseActionResult {
    let target = try focusTarget(
      pid: request.pid,
      windowID: request.windowID,
      elementIndex: request.elementIndex
    )
    let dispatch = try focusGuard.withFocusSuppressed(pid: pid_t(request.pid), element: target) {
      try ComputerUseKeyboardInput.press(
        key: request.key,
        modifiers: request.modifiers,
        pid: pid_t(request.pid)
      )
    }
    return .init(ok: true, dispatch: dispatch.rawValue)
  }

  public func scroll(
    _ request: SupatermComputerUseScrollRequest
  ) throws -> SupatermComputerUseActionResult {
    let target = try focusTarget(
      pid: request.pid,
      windowID: request.windowID,
      elementIndex: request.elementIndex
    )
    let key = ComputerUseKeyboardInput.scrollKeys(direction: request.direction, unit: request.unit)
    var dispatch = ComputerUseKeyboardDispatch.pidEvent
    try focusGuard.withFocusSuppressed(pid: pid_t(request.pid), element: target) {
      for _ in 0..<max(1, request.amount) {
        dispatch = try ComputerUseKeyboardInput.press(
          key: key.key,
          modifiers: key.modifiers,
          pid: pid_t(request.pid)
        )
        usleep(18_000)
      }
    }
    return .init(ok: true, dispatch: dispatch.rawValue)
  }

  public func setValue(
    _ request: SupatermComputerUseSetValueRequest
  ) throws -> SupatermComputerUseActionResult {
    let element = try cachedElement(
      pid: request.pid,
      windowID: request.windowID,
      elementIndex: request.elementIndex
    )
    if axString(element, kAXRoleAttribute as CFString) == kAXPopUpButtonRole as String {
      return try selectPopupValue(element, request: request)
    }
    let result = focusGuard.withFocusSuppressed(pid: pid_t(request.pid), element: element) {
      AXUIElementSetAttributeValue(
        element,
        kAXValueAttribute as CFString,
        request.value as CFTypeRef
      )
    }
    guard result == .success else { throw ComputerUseError.unsupportedBackgroundTarget }
    return .init(ok: true, dispatch: "accessibility")
  }

  private func screenRecordingGranted() async -> Bool {
    do {
      _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      return true
    } catch {
      return false
    }
  }

  private func windowInfos(onScreenOnly: Bool = false) -> [ComputerUseWindowInfo] {
    let options: CGWindowListOption =
      onScreenOnly ? [.optionOnScreenOnly, .excludeDesktopElements] : [.optionAll, .excludeDesktopElements]
    guard
      let array = CGWindowListCopyWindowInfo(
        options,
        kCGNullWindowID
      )
        as? [[String: Any]]
    else {
      return []
    }
    let currentSpaceID = ComputerUseSpaceLookup.currentSpaceID()
    let total = array.count
    return array.enumerated().compactMap { offset, dictionary in
      ComputerUseWindowInfo(dictionary, zIndex: total - offset, currentSpaceID: currentSpaceID)
    }
    .filter { $0.window.layer == 0 }
  }

  private func windowInfo(windowID: UInt32, pid: Int) -> ComputerUseWindowInfo? {
    windowInfos().first { $0.window.id == windowID && $0.window.pid == pid }
  }

  private func pidFilter(for app: String?) -> Int? {
    guard let app, !app.isEmpty else { return nil }
    if let pid = Int(app) {
      return pid
    }
    return NSWorkspace.shared.runningApplications.first {
      $0.bundleIdentifier == app || $0.localizedName == app
    }
    .map { Int($0.processIdentifier) }
  }

  private func applicationURL(bundleID: String?, name: String?) throws -> URL {
    if let bundleID,
      let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleID)
    {
      return url
    }
    if let name {
      if name.hasPrefix("/") || name.hasPrefix("~") {
        let path = NSString(string: name).expandingTildeInPath
        let url = URL(fileURLWithPath: path)
        if FileManager.default.fileExists(atPath: url.path) {
          return url
        }
      }
      for directory in applicationSearchDirectories() {
        let url = directory.appendingPathComponent("\(name).app")
        if FileManager.default.fileExists(atPath: url.path) {
          return url
        }
      }
      if let running = NSWorkspace.shared.runningApplications.first(where: { $0.localizedName == name }),
        let url = running.bundleURL
      {
        return url
      }
    }
    throw ComputerUseError.launchFailed("Could not find the requested application.")
  }

  private func launchURL(_ rawValue: String) throws -> URL {
    let expanded = NSString(string: rawValue).expandingTildeInPath
    if let url = URL(string: rawValue), url.scheme != nil {
      return url
    }
    return URL(fileURLWithPath: expanded)
  }

  private func applicationSearchDirectories() -> [URL] {
    var urls = [
      URL(fileURLWithPath: "/Applications"),
      URL(fileURLWithPath: "/System/Applications"),
      URL(fileURLWithPath: "/System/Applications/Utilities"),
    ]
    urls.append(FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Applications"))
    return urls
  }

  private func restoreTarget(
    for app: NSRunningApplication
  ) -> ComputerUseSystemFocusStealPreventer.RunningApplication {
    .init(processIdentifier: app.processIdentifier) {
      _ = app.activate(options: [])
    }
  }

  private func suppressLaunchFocusSteal(
    target app: NSRunningApplication,
    restoreTo restoreTarget: ComputerUseSystemFocusStealPreventer.RunningApplication,
    placeholderSuppression: ComputerUseSystemFocusStealPreventer.Handle?
  ) async {
    if let placeholderSuppression {
      launchFocusStealPreventer.end(placeholderSuppression)
    }
    let suppression = launchFocusStealPreventer.begin(
      targetPid: app.processIdentifier,
      restoreTo: restoreTarget
    )
    try? await Task.sleep(nanoseconds: 500_000_000)
    if let suppression {
      launchFocusStealPreventer.end(suppression)
    }
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier {
      restoreTarget.activate()
    }
  }

  private func matchingWindow(
    in appElement: AXUIElement,
    windowID: UInt32
  ) -> AXUIElement? {
    topLevelChildren(of: appElement).first { element in
      axString(element, kAXRoleAttribute as CFString) == kAXWindowRole as String
        && elementWindowID(element) == windowID
    }
  }

  private func focusTarget(
    pid: Int,
    windowID: UInt32?,
    elementIndex: Int?
  ) throws -> AXUIElement? {
    if let elementIndex {
      guard let windowID else { throw ComputerUseError.snapshotRequired }
      return try cachedElement(pid: pid, windowID: windowID, elementIndex: elementIndex)
    }
    if let windowID {
      return matchingWindow(in: AXUIElementCreateApplication(pid_t(pid)), windowID: windowID)
    }
    return nil
  }

  private func currentSnapshotMode() -> SupatermComputerUseSnapshotMode {
    @Shared(.supatermSettings) var supatermSettings = .default
    return supatermSettings.computerUseSnapshotMode
  }

  private func elementMatchesQuery(
    _ element: SupatermComputerUseElement,
    query: String?
  ) -> Bool {
    guard let query, !query.isEmpty else { return true }
    let haystack = [
      element.role,
      element.title,
      element.value,
      element.description,
      element.identifier,
      element.help,
      element.actions.joined(separator: " "),
    ]
    .compactMap(\.self)
    .joined(separator: " ")
    return haystack.localizedCaseInsensitiveContains(query)
  }

  private func collectElements(
    _ element: AXUIElement,
    windowID: UInt32,
    collection: inout ComputerUseElementCollection,
    depth: Int
  ) {
    guard depth <= 10, collection.cache.count < 400 else { return }
    let role = axString(element, kAXRoleAttribute as CFString) ?? "unknown"
    let actions = actionNames(element)
    let frame = elementFrame(element).map(rect)
    let isActionable = actionable(role: role, actions: actions, frame: frame)
    if isActionable {
      let index = collection.nextIndex
      collection.nextIndex += 1
      collection.cache[index] = element
      collection.elements.append(
        .init(
          elementIndex: index,
          role: role,
          title: axString(element, kAXTitleAttribute as CFString),
          value: axString(element, kAXValueAttribute as CFString),
          description: axString(element, kAXDescriptionAttribute as CFString),
          identifier: axString(element, kAXIdentifierAttribute as CFString),
          help: axString(element, kAXHelpAttribute as CFString),
          frame: frame,
          isEnabled: axBool(element, kAXEnabledAttribute as CFString),
          isFocused: axBool(element, kAXFocusedAttribute as CFString),
          actions: actions
        )
      )
    }
    if role == kAXMenuRole as String && !menuIsOpen(element) {
      return
    }
    var children =
      depth == 0 && role == kAXApplicationRole as String
      ? topLevelChildren(of: element)
      : axArray(element, kAXChildrenAttribute as CFString) ?? []
    if depth == 0 && role == kAXApplicationRole as String {
      children = children.filter { child in
        let childRole = axString(child, kAXRoleAttribute as CFString)
        guard childRole == kAXWindowRole as String else { return true }
        return elementWindowID(child) == windowID
      }
    }
    for child in children {
      collectElements(
        child,
        windowID: windowID,
        collection: &collection,
        depth: depth + 1
      )
    }
  }

  private func actionable(
    role: String,
    actions: [String],
    frame: SupatermComputerUseRect?
  ) -> Bool {
    if !actions.isEmpty { return true }
    guard frame != nil else { return false }
    return actionableRoles.contains(role)
  }

  private func topLevelChildren(of appElement: AXUIElement) -> [AXUIElement] {
    var children = axArray(appElement, kAXChildrenAttribute as CFString) ?? []
    for window in axArray(appElement, kAXWindowsAttribute as CFString) ?? []
    where !children.contains(where: { CFEqual($0, window) }) {
      children.append(window)
    }
    return children
  }

  private func menuIsOpen(_ element: AXUIElement) -> Bool {
    !(axArray(element, "AXVisibleChildren" as CFString) ?? []).isEmpty
  }

  private func actionNames(_ element: AXUIElement) -> [String] {
    var names: CFArray?
    guard AXUIElementCopyActionNames(element, &names) == .success else { return [] }
    return (names as? [String] ?? []).map(cleanActionName)
  }

  private func cleanActionName(_ raw: String) -> String {
    if raw.hasPrefix("AX") { return raw }
    for line in raw.split(whereSeparator: \.isNewline) {
      if let range = line.range(of: "Name:") {
        let name = line[range.upperBound...].trimmingCharacters(in: .whitespaces)
        if !name.isEmpty { return name }
      }
    }
    return raw
  }

  private func elementWindowID(_ element: AXUIElement) -> UInt32? {
    var windowID = CGWindowID(0)
    guard _AXUIElementGetWindow(element, &windowID) == .success, windowID != 0 else {
      return nil
    }
    return UInt32(windowID)
  }

  private func screenshot(windowID: UInt32, outputPath: String?) async throws
    -> SupatermComputerUseScreenshot?
  {
    let content: SCShareableContent
    do {
      content = try await SCShareableContent.excludingDesktopWindows(
        false, onScreenWindowsOnly: true)
    } catch {
      if outputPath != nil {
        throw ComputerUseError.screenRecordingPermissionMissing
      }
      return nil
    }

    guard let window = content.windows.first(where: { $0.windowID == CGWindowID(windowID) }) else {
      if outputPath != nil {
        throw ComputerUseError.screenRecordingPermissionMissing
      }
      return nil
    }

    let filter = SCContentFilter(desktopIndependentWindow: window)
    let configuration = SCStreamConfiguration()
    let scale = CGFloat(filter.pointPixelScale)
    configuration.width = Int(max(1, ceil(window.frame.width * scale)))
    configuration.height = Int(max(1, ceil(window.frame.height * scale)))
    configuration.showsCursor = false
    configuration.scalesToFit = true
    configuration.ignoreShadowsSingleWindow = true

    let image = try await captureImage(filter: filter, configuration: configuration)

    if let outputPath {
      let url = URL(fileURLWithPath: NSString(string: outputPath).expandingTildeInPath)
      guard
        let destination = CGImageDestinationCreateWithURL(
          url as CFURL, "public.png" as CFString, 1, nil)
      else {
        throw ComputerUseError.imageWriteFailed(outputPath)
      }
      CGImageDestinationAddImage(destination, image, nil)
      guard CGImageDestinationFinalize(destination) else {
        throw ComputerUseError.imageWriteFailed(outputPath)
      }
      return .init(path: url.path, width: image.width, height: image.height, scale: Double(scale))
    }

    return .init(path: nil, width: image.width, height: image.height, scale: Double(scale))
  }

  private func captureImage(filter: SCContentFilter, configuration: SCStreamConfiguration)
    async throws
    -> CGImage
  {
    try await withCheckedThrowingContinuation { continuation in
      SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration) {
        image, error in
        if let error {
          continuation.resume(throwing: error)
        } else if let image {
          continuation.resume(returning: image)
        } else {
          continuation.resume(throwing: ComputerUseError.screenRecordingPermissionMissing)
        }
      }
    }
  }

  private func cachedElement(
    pid: Int,
    windowID: UInt32,
    elementIndex: Int
  ) throws -> AXUIElement {
    guard let cache = elementCache[.init(pid: pid, windowID: windowID)] else {
      throw ComputerUseError.snapshotRequired
    }
    guard let element = cache[elementIndex] else {
      throw ComputerUseError.elementNotFound(elementIndex)
    }
    return element
  }

  private func clickElement(
    _ element: AXUIElement,
    request: SupatermComputerUseClickRequest
  ) async throws -> SupatermComputerUseActionResult {
    if axBool(element, kAXEnabledAttribute as CFString) == false, let index = request.elementIndex {
      throw ComputerUseError.elementDisabled(index)
    }
    let point = elementTargetPoint(element)
    let actions = actionNames(element)
    if let axAction = ComputerUseClickActionResolver.accessibilityAction(
      request: request,
      advertisedActions: actions
    ) {
      let preparedCursor: ComputerUsePreparedCursor?
      if let point {
        preparedCursor = await prepareCursor(
          to: point,
          aboveWindowID: request.windowID,
          targetPid: request.pid
        )
      } else {
        preparedCursor = nil
      }
      let success = focusGuard.withFocusSuppressed(pid: pid_t(request.pid), element: element) {
        performAction(axAction as CFString, on: element)
      }
      if success {
        await finishCursorClick(preparedCursor)
        if axAction == kAXPressAction as String,
          isTextEntryRole(axString(element, kAXRoleAttribute as CFString))
        {
          usleep(800_000)
        }
        return .init(
          ok: true,
          dispatch: ComputerUseMouseDispatch.accessibility.rawValue,
          warning: ComputerUseClickActionResolver.warning(
            role: axString(element, kAXRoleAttribute as CFString),
            action: axAction,
            advertisedActions: actions
          )
        )
      }
      cancelCursorClick(preparedCursor)
      if let index = request.elementIndex {
        throw ComputerUseError.actionFailed(index, axAction)
      }
      throw ComputerUseError.unsupportedBackgroundTarget
    }
    guard let point else {
      throw ComputerUseError.unsupportedBackgroundTarget
    }
    return try await postClick(
      point: point,
      request: request
    )
  }

  private func postClick(
    point: CGPoint,
    request: SupatermComputerUseClickRequest,
    preparedCursor: ComputerUsePreparedCursor? = nil
  ) async throws -> SupatermComputerUseActionResult {
    guard let windowInfo = windowInfo(windowID: request.windowID, pid: request.pid) else {
      throw ComputerUseError.windowNotFound(request.windowID)
    }
    let cursor: ComputerUsePreparedCursor?
    if let preparedCursor {
      cursor = preparedCursor
    } else {
      cursor = await prepareCursor(
        to: point,
        aboveWindowID: request.windowID,
        targetPid: request.pid
      )
    }
    do {
      let dispatch = try ComputerUseMouseInput.click(
        .init(
          point: point,
          pid: pid_t(request.pid),
          window: .init(id: windowInfo.window.id, frame: windowInfo.window.frame),
          button: request.button,
          count: request.count,
          modifiers: request.modifiers
        )
      )
      await finishCursorClick(cursor)
      return .init(ok: true, dispatch: dispatch.rawValue)
    } catch {
      cancelCursorClick(cursor)
      throw error
    }
  }

  private func prepareCursor(
    to point: CGPoint,
    aboveWindowID windowID: UInt32,
    targetPid: Int
  ) async -> ComputerUsePreparedCursor? {
    @Shared(.supatermSettings) var supatermSettings = .default
    return await cursorOverlay.prepareClick(
      to: point,
      enabled: supatermSettings.computerUseShowAgentCursor,
      alwaysFloat: supatermSettings.computerUseAlwaysFloatAgentCursor,
      targetPid: pid_t(targetPid),
      targetWindowID: windowID
    )
  }

  private func finishCursorClick(_ cursor: ComputerUsePreparedCursor?) async {
    guard let cursor else { return }
    await cursorOverlay.completeClick(cursor)
  }

  private func cancelCursorClick(_ cursor: ComputerUsePreparedCursor?) {
    guard let cursor else { return }
    cursorOverlay.cancelClick(cursor)
  }

  private func axArray(_ element: AXUIElement, _ attribute: CFString) -> [AXUIElement]? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
    return value as? [AXUIElement]
  }

  private func axString(_ element: AXUIElement, _ attribute: CFString) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
    if let string = value as? String {
      return string.isEmpty ? nil : string
    }
    if let attributed = value as? NSAttributedString {
      let string = attributed.string
      return string.isEmpty ? nil : string
    }
    return nil
  }

  private func axBool(_ element: AXUIElement, _ attribute: CFString) -> Bool? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
    return value as? Bool
  }

  private func elementFrame(_ element: AXUIElement) -> CGRect? {
    var positionValue: CFTypeRef?
    var sizeValue: CFTypeRef?
    guard
      AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionValue)
        == .success,
      AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeValue) == .success,
      let positionAXValue = axValue(positionValue),
      let sizeAXValue = axValue(sizeValue)
    else {
      return nil
    }

    var position = CGPoint.zero
    var size = CGSize.zero
    guard
      AXValueGetValue(positionAXValue, .cgPoint, &position),
      AXValueGetValue(sizeAXValue, .cgSize, &size)
    else {
      return nil
    }
    return .init(origin: position, size: size)
  }

  private func elementTargetPoint(_ element: AXUIElement) -> CGPoint? {
    guard let frame = elementFrame(element) else { return nil }
    let point = center(of: frame)
    if hitTestResolves(to: element, at: point) {
      return point
    }
    let columns = 5
    let rows = 5
    for row in 0..<rows {
      for column in 0..<columns {
        if (row == 0 || row == rows - 1) && (column == 0 || column == columns - 1) {
          continue
        }
        let x = frame.minX + frame.width * ((CGFloat(column) + 0.5) / CGFloat(columns))
        let y = frame.minY + frame.height * ((CGFloat(row) + 0.5) / CGFloat(rows))
        let candidate = CGPoint(x: x, y: y)
        if hitTestResolves(to: element, at: candidate) {
          return candidate
        }
      }
    }
    return point
  }

  private func hitTestResolves(to target: AXUIElement, at point: CGPoint) -> Bool {
    let system = AXUIElementCreateSystemWide()
    var hit: AXUIElement?
    guard
      AXUIElementCopyElementAtPosition(system, Float(point.x), Float(point.y), &hit) == .success,
      let hit
    else {
      return false
    }
    var current: AXUIElement? = hit
    for _ in 0..<16 {
      guard let node = current else { return false }
      if CFEqual(node, target) {
        return true
      }
      var parent: CFTypeRef?
      guard
        AXUIElementCopyAttributeValue(node, kAXParentAttribute as CFString, &parent) == .success,
        let parent,
        CFGetTypeID(parent) == AXUIElementGetTypeID()
      else {
        return false
      }
      current = unsafeDowncast(parent, to: AXUIElement.self)
    }
    return false
  }

  private func performAction(_ action: CFString, on element: AXUIElement) -> Bool {
    AXUIElementPerformAction(element, action) == .success
  }

  private func isTextEntryRole(_ role: String?) -> Bool {
    guard let role else { return false }
    return role == kAXTextFieldRole as String
      || role == kAXTextAreaRole as String
      || role == kAXComboBoxRole as String
      || role == "AXSearchField"
  }

  private func selectPopupValue(
    _ element: AXUIElement,
    request: SupatermComputerUseSetValueRequest
  ) throws -> SupatermComputerUseActionResult {
    let children = axArray(element, kAXChildrenAttribute as CFString) ?? []
    let normalized = request.value.lowercased()
    for child in children {
      let title = axString(child, kAXTitleAttribute as CFString)?.lowercased()
      let value = axString(child, kAXValueAttribute as CFString)?.lowercased()
      if title == normalized || value == normalized {
        let success = focusGuard.withFocusSuppressed(pid: pid_t(request.pid), element: child) {
          performAction(kAXPressAction as CFString, on: child)
        }
        guard success else { throw ComputerUseError.unsupportedBackgroundTarget }
        return .init(ok: true, dispatch: "accessibility")
      }
    }
    throw ComputerUseError.actionUnsupported(request.elementIndex, "select_option")
  }

  private func axValue(_ value: CFTypeRef?) -> AXValue? {
    guard let value, CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
    return unsafeDowncast(value, to: AXValue.self)
  }

  private func rect(_ frame: CGRect) -> SupatermComputerUseRect {
    .init(x: frame.origin.x, y: frame.origin.y, width: frame.width, height: frame.height)
  }

  private func center(of frame: CGRect) -> CGPoint {
    .init(x: frame.midX, y: frame.midY)
  }

  private func screenPoint(windowPixel: CGPoint, pid: Int, windowID: UInt32) throws -> CGPoint {
    guard let window = windowInfo(windowID: windowID, pid: pid) else {
      throw ComputerUseError.windowNotFound(windowID)
    }
    let scale = backingScale(for: window.window.frame)
    return .init(
      x: window.window.frame.x + windowPixel.x / scale,
      y: window.window.frame.y + windowPixel.y / scale
    )
  }

  private func backingScale(for frame: SupatermComputerUseRect) -> Double {
    let rect = CGRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height)
    var best: NSScreen?
    var bestArea = 0.0
    for screen in NSScreen.screens {
      let intersection = screen.frame.intersection(rect)
      guard !intersection.isNull else { continue }
      let area = intersection.width * intersection.height
      if area > bestArea {
        bestArea = area
        best = screen
      }
    }
    if let best {
      return Double(best.backingScaleFactor)
    }
    if let main = NSScreen.main {
      return Double(main.backingScaleFactor)
    }
    return 1
  }

  private let actionableRoles: Set<String> = [
    kAXButtonRole as String,
    kAXCheckBoxRole as String,
    kAXComboBoxRole as String,
    kAXDisclosureTriangleRole as String,
    "AXLink",
    kAXMenuButtonRole as String,
    kAXMenuItemRole as String,
    kAXPopUpButtonRole as String,
    kAXRadioButtonRole as String,
    kAXSliderRole as String,
    kAXTextAreaRole as String,
    kAXTextFieldRole as String,
    "AXSearchField",
  ]
}

private struct ComputerUseElementCollection {
  var elements: [SupatermComputerUseElement] = []
  var cache: [Int: AXUIElement] = [:]
  var nextIndex = 1
}

private struct ComputerUseWindowInfo {
  let window: SupatermComputerUseWindow
  let pid: Int

  init?(
    _ dictionary: [String: Any],
    zIndex: Int,
    currentSpaceID: UInt64?
  ) {
    guard
      let windowNumber = dictionary[kCGWindowNumber as String] as? NSNumber,
      let pidNumber = dictionary[kCGWindowOwnerPID as String] as? NSNumber,
      let appName = dictionary[kCGWindowOwnerName as String] as? String,
      let bounds = dictionary[kCGWindowBounds as String] as? [String: Any],
      let xNumber = bounds["X"] as? NSNumber,
      let yNumber = bounds["Y"] as? NSNumber,
      let widthNumber = bounds["Width"] as? NSNumber,
      let heightNumber = bounds["Height"] as? NSNumber
    else {
      return nil
    }
    let windowID = windowNumber.uint32Value
    let pid = pidNumber.intValue
    let x = xNumber.doubleValue
    let y = yNumber.doubleValue
    let width = widthNumber.doubleValue
    let height = heightNumber.doubleValue
    let title = dictionary[kCGWindowName as String] as? String
    let isOnScreen = (dictionary[kCGWindowIsOnscreen as String] as? Bool) ?? true
    let layer = (dictionary[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0
    let spaceIDs = ComputerUseSpaceLookup.spaceIDs(for: windowID)
    self.pid = pid
    self.window = .init(
      id: windowID,
      pid: pid,
      appName: appName,
      title: title?.isEmpty == true ? nil : title,
      frame: .init(x: x, y: y, width: width, height: height),
      isOnScreen: isOnScreen,
      zIndex: zIndex,
      layer: layer,
      onCurrentSpace: currentSpaceID.flatMap { current in spaceIDs?.contains(current) },
      spaceIDs: spaceIDs
    )
  }
}
