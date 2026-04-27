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

  private struct ZoomContext {
    let source: CGRect
    let snapshotToNativeRatio: Double
  }

  private struct ScreenshotCaptureRequest {
    let windowID: UInt32
    let outputPath: String?
    let format: SupatermComputerUseImageFormat
    let quality: Double?
    let maxImageDimension: Int
    let cacheKey: CacheKey?
  }

  private let cursorOverlay = ComputerUseCursorOverlay()
  private let focusGuard = ComputerUseFocusGuard()
  private let launchFocusStealPreventer = ComputerUseSystemFocusStealPreventer()
  private let pageRuntime = ComputerUsePageRuntime()
  private let recorder = ComputerUseRecorder()
  private var elementCache: [CacheKey: [Int: AXUIElement]] = [:]
  private var resizeRatios: [CacheKey: Double] = [:]
  private var zoomContexts: [CacheKey: ZoomContext] = [:]
  private var recordingSuppressed = false

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

  public func screenSize() -> SupatermComputerUseScreenSizeResult {
    let displayID = CGMainDisplayID()
    let bounds = CGDisplayBounds(displayID)
    let scale =
      bounds.width > 0 ? Double(CGDisplayPixelsWide(displayID)) / Double(bounds.width) : 1
    return .init(width: bounds.width, height: bounds.height, scale: scale)
  }

  public func cursorPosition() -> SupatermComputerUseCursorPositionResult {
    let point = CGEvent(source: nil)?.location ?? .zero
    return .init(x: point.x, y: point.y)
  }

  public func moveCursor(
    _ request: SupatermComputerUseMoveCursorRequest
  ) throws -> SupatermComputerUseActionResult {
    CGWarpMouseCursorPosition(.init(x: request.x, y: request.y))
    CGAssociateMouseAndMouseCursorPosition(boolean_t(1))
    return .init(ok: true, dispatch: "core-graphics")
  }

  public func cursorState() -> SupatermComputerUseCursorResult {
    @Shared(.supatermSettings) var supatermSettings = .default
    return .init(
      enabled: supatermSettings.computerUseShowAgentCursor,
      alwaysFloat: supatermSettings.computerUseAlwaysFloatAgentCursor,
      motion: supatermSettings.computerUseCursorMotion
    )
  }

  public func cursorSet(
    _ request: SupatermComputerUseCursorRequest
  ) throws -> SupatermComputerUseCursorResult {
    @Shared(.supatermSettings) var supatermSettings = .default
    var next = supatermSettings
    if let enabled = request.enabled {
      next.computerUseShowAgentCursor = enabled
    }
    if let alwaysFloat = request.alwaysFloat {
      next.computerUseAlwaysFloatAgentCursor = alwaysFloat
    }
    if let motion = request.motion {
      next.computerUseCursorMotion = motion
    }
    if request.startHandle != nil
      || request.endHandle != nil
      || request.arcSize != nil
      || request.arcFlow != nil
      || request.spring != nil
      || request.glideDurationMilliseconds != nil
      || request.dwellAfterClickMilliseconds != nil
      || request.idleHideMilliseconds != nil
    {
      let current = next.computerUseCursorMotion
      next.computerUseCursorMotion = .init(
        startHandle: request.startHandle ?? current.startHandle,
        endHandle: request.endHandle ?? current.endHandle,
        arcSize: request.arcSize ?? current.arcSize,
        arcFlow: request.arcFlow ?? current.arcFlow,
        spring: request.spring ?? current.spring,
        glideDurationMilliseconds: request.glideDurationMilliseconds ?? current.glideDurationMilliseconds,
        dwellAfterClickMilliseconds: request.dwellAfterClickMilliseconds ?? current.dwellAfterClickMilliseconds,
        idleHideMilliseconds: request.idleHideMilliseconds ?? current.idleHideMilliseconds
      )
    }
    $supatermSettings.withLock {
      $0 = next
    }
    return .init(
      enabled: next.computerUseShowAgentCursor,
      alwaysFloat: next.computerUseAlwaysFloatAgentCursor,
      motion: next.computerUseCursorMotion
    )
  }

  private func hotkeyParts(
    _ values: [String]
  ) throws -> (key: String, modifiers: [SupatermComputerUseKeyModifier]) {
    let tokens =
      values
      .flatMap { $0.split(separator: "+") }
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
      .filter { !$0.isEmpty }
    var modifiers = Set<SupatermComputerUseKeyModifier>()
    var key: String?
    for token in tokens {
      switch token {
      case "cmd", "command", "meta":
        modifiers.insert(.command)
      case "shift":
        modifiers.insert(.shift)
      case "alt", "option", "opt":
        modifiers.insert(.option)
      case "control", "ctrl":
        modifiers.insert(.control)
      case "fn", "function":
        modifiers.insert(.function)
      default:
        key = token
      }
    }
    guard let key else {
      throw ComputerUseError.keyUnsupported(values.joined(separator: "+"))
    }
    let order: [SupatermComputerUseKeyModifier] = [.command, .shift, .option, .control, .function]
    return (key, order.filter(modifiers.contains))
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
    var arguments = request.arguments
    if let electronDebuggingPort = request.electronDebuggingPort {
      arguments.append("--remote-debugging-port=\(electronDebuggingPort)")
    }
    if !arguments.isEmpty {
      configuration.arguments = arguments
    }
    var requestEnvironment = request.environment
    if let webkitInspectorPort = request.webkitInspectorPort {
      requestEnvironment["WEBKIT_INSPECTOR_SERVER"] = "127.0.0.1:\(webkitInspectorPort)"
      requestEnvironment["TAURI_WEBVIEW_AUTOMATION"] = "1"
    }
    if !requestEnvironment.isEmpty {
      var environment = ProcessInfo.processInfo.environment
      environment.merge(requestEnvironment) { _, new in new }
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
      : try await screenshot(
        .init(
          windowID: request.windowID,
          outputPath: request.imageOutputPath,
          format: .png,
          quality: nil,
          maxImageDimension: currentMaxImageDimension(),
          cacheKey: .init(pid: request.pid, windowID: request.windowID)
        )
      )
    let javascript = await snapshotJavaScript(request)
    return .init(
      pid: request.pid,
      windowID: request.windowID,
      frame: windowInfo.window.frame,
      elements: filteredElements,
      screenshot: screenshot,
      javascript: javascript
    )
  }

  public func screenshot(
    _ request: SupatermComputerUseScreenshotRequest
  ) async throws -> SupatermComputerUseScreenshot {
    if let windowID = request.windowID {
      guard
        let screenshot = try await screenshot(
          .init(
            windowID: windowID,
            outputPath: request.imageOutputPath,
            format: request.format,
            quality: request.quality,
            maxImageDimension: currentMaxImageDimension(),
            cacheKey: nil
          )
        )
      else {
        throw ComputerUseError.screenRecordingPermissionMissing
      }
      return screenshot
    }
    let image = try await mainDisplayImage()
    let prepared = resizedImage(image, maxImageDimension: currentMaxImageDimension())
    let url = URL(fileURLWithPath: NSString(string: request.imageOutputPath).expandingTildeInPath)
    try writeImage(prepared.image, to: url, format: request.format, quality: request.quality)
    return .init(
      path: url.path,
      width: prepared.image.width,
      height: prepared.image.height,
      originalWidth: image.width,
      originalHeight: image.height,
      scale: screenSize().scale
    )
  }

  public func zoom(
    _ request: SupatermComputerUseZoomRequest
  ) async throws -> SupatermComputerUseZoomResult {
    guard windowInfo(windowID: request.windowID, pid: request.pid) != nil else {
      throw ComputerUseError.windowNotFound(request.windowID)
    }
    let key = CacheKey(pid: request.pid, windowID: request.windowID)
    let ratio = resizeRatios[key] ?? 1
    let capture = try await windowImage(windowID: request.windowID)
    let nativeSource = CGRect(
      x: request.x * ratio,
      y: request.y * ratio,
      width: request.width * ratio,
      height: request.height * ratio
    )
    let padded = nativeSource.insetBy(dx: -nativeSource.width * 0.2, dy: -nativeSource.height * 0.2)
    let bounds = CGRect(x: 0, y: 0, width: capture.image.width, height: capture.image.height)
    let crop = padded.intersection(bounds)
    guard !crop.isNull, let cropped = capture.image.cropping(to: crop.integral) else {
      throw ComputerUseError.invalidClickTarget
    }
    let url = URL(fileURLWithPath: NSString(string: request.imageOutputPath).expandingTildeInPath)
    try writeImage(cropped, to: url, format: .png, quality: nil)
    let source = SupatermComputerUseRect(
      x: crop.origin.x,
      y: crop.origin.y,
      width: crop.width,
      height: crop.height
    )
    zoomContexts[key] = .init(source: crop, snapshotToNativeRatio: ratio)
    return .init(
      pid: request.pid,
      windowID: request.windowID,
      source: source,
      screenshot: .init(
        path: url.path,
        width: cropped.width,
        height: cropped.height,
        originalWidth: cropped.width,
        originalHeight: cropped.height,
        scale: capture.scale
      ),
      snapshotToNativeRatio: ratio
    )
  }

  public func click(
    _ request: SupatermComputerUseClickRequest
  ) async throws -> SupatermComputerUseActionResult {
    if let elementIndex = request.elementIndex {
      let element = try cachedElement(
        pid: request.pid, windowID: request.windowID, elementIndex: elementIndex)
      let result = try await clickElement(element, request: request)
      await recordAction(
        method: SupatermSocketMethod.computerUseClick,
        request: request,
        result: result,
        windowID: request.windowID,
        marker: nil
      )
      return result
    }

    guard let x = request.x, let y = request.y else {
      throw ComputerUseError.invalidClickTarget
    }
    if request.debugImageOutputPath != nil && request.fromZoom {
      throw ComputerUseError.invalidClickTarget
    }
    if let debugImageOutputPath = request.debugImageOutputPath {
      try await writeDebugClickImage(
        windowID: request.windowID,
        point: .init(x: x, y: y),
        outputPath: debugImageOutputPath
      )
    }
    let result = try await postClick(
      point: try screenPoint(
        windowPixel: .init(x: x, y: y),
        pid: request.pid,
        windowID: request.windowID,
        fromZoom: request.fromZoom
      ),
      request: request
    )
    await recordAction(
      method: SupatermSocketMethod.computerUseClick,
      request: request,
      result: result,
      windowID: request.windowID,
      marker: request.fromZoom ? nil : .init(x: x, y: y)
    )
    return result
  }

  public func type(
    _ request: SupatermComputerUseTypeRequest
  ) async throws -> SupatermComputerUseActionResult {
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
        let result = SupatermComputerUseActionResult(ok: true, dispatch: "accessibility")
        await recordAction(
          method: SupatermSocketMethod.computerUseType,
          request: request,
          result: result,
          windowID: request.windowID,
          marker: nil
        )
        return result
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
    let result = SupatermComputerUseActionResult(ok: true, dispatch: dispatch.rawValue)
    await recordAction(
      method: SupatermSocketMethod.computerUseType,
      request: request,
      result: result,
      windowID: request.windowID,
      marker: nil
    )
    return result
  }

  public func key(
    _ request: SupatermComputerUseKeyRequest
  ) async throws -> SupatermComputerUseActionResult {
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
    let result = SupatermComputerUseActionResult(ok: true, dispatch: dispatch.rawValue)
    await recordAction(
      method: SupatermSocketMethod.computerUseKey,
      request: request,
      result: result,
      windowID: request.windowID,
      marker: nil
    )
    return result
  }

  public func hotkey(
    _ request: SupatermComputerUseHotkeyRequest
  ) async throws -> SupatermComputerUseActionResult {
    let parsed = try hotkeyParts(request.keys)
    let wasSuppressed = recordingSuppressed
    recordingSuppressed = true
    let keyRequest = SupatermComputerUseKeyRequest(
      pid: request.pid,
      windowID: request.windowID,
      elementIndex: request.elementIndex,
      key: parsed.key,
      modifiers: parsed.modifiers
    )
    let result: SupatermComputerUseActionResult
    do {
      result = try await key(keyRequest)
    } catch {
      recordingSuppressed = wasSuppressed
      throw error
    }
    recordingSuppressed = wasSuppressed
    await recordAction(
      method: SupatermSocketMethod.computerUseHotkey,
      request: request,
      result: result,
      windowID: request.windowID,
      marker: nil
    )
    return result
  }

  public func scroll(
    _ request: SupatermComputerUseScrollRequest
  ) async throws -> SupatermComputerUseActionResult {
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
    let result = SupatermComputerUseActionResult(ok: true, dispatch: dispatch.rawValue)
    await recordAction(
      method: SupatermSocketMethod.computerUseScroll,
      request: request,
      result: result,
      windowID: request.windowID,
      marker: nil
    )
    return result
  }

  public func setValue(
    _ request: SupatermComputerUseSetValueRequest
  ) async throws -> SupatermComputerUseActionResult {
    let element = try cachedElement(
      pid: request.pid,
      windowID: request.windowID,
      elementIndex: request.elementIndex
    )
    if axString(element, kAXRoleAttribute as CFString) == kAXPopUpButtonRole as String {
      let result = try await selectPopupValue(element, request: request)
      await recordAction(
        method: SupatermSocketMethod.computerUseSetValue,
        request: request,
        result: result,
        windowID: request.windowID,
        marker: nil
      )
      return result
    }
    let result = focusGuard.withFocusSuppressed(pid: pid_t(request.pid), element: element) {
      AXUIElementSetAttributeValue(
        element,
        kAXValueAttribute as CFString,
        request.value as CFTypeRef
      )
    }
    guard result == .success else { throw ComputerUseError.unsupportedBackgroundTarget }
    let actionResult = SupatermComputerUseActionResult(ok: true, dispatch: "accessibility")
    await recordAction(
      method: SupatermSocketMethod.computerUseSetValue,
      request: request,
      result: actionResult,
      windowID: request.windowID,
      marker: nil
    )
    return actionResult
  }

  public func page(
    _ request: SupatermComputerUsePageRequest
  ) async throws -> SupatermComputerUsePageResult {
    let result = try await pageRuntime.page(request)
    await recordAction(
      method: SupatermSocketMethod.computerUsePage,
      request: request,
      result: result,
      windowID: request.windowID,
      marker: nil
    )
    return result
  }

  public func recording(
    _ request: SupatermComputerUseRecordingRequest
  ) async throws -> SupatermComputerUseRecordingResult {
    switch request.action {
    case .start:
      return try recorder.start(directory: request.directory)
    case .stop:
      return recorder.stop()
    case .status:
      return recorder.status()
    case .replay:
      return try await replayRecording(request)
    case .render:
      return try recorder.render(directory: request.directory, outputPath: request.outputPath)
    }
  }

  private func recordAction<Request: Encodable, Result: Encodable>(
    method: String,
    request: Request,
    result: Result,
    windowID: UInt32?,
    marker: CGPoint?
  ) async {
    guard !recordingSuppressed, let turn = try? recorder.beginTurn() else {
      return
    }
    var screenshotPath: String?
    var markerPath: String?
    if let windowID {
      let screenshotURL = turn.directory.appendingPathComponent("screenshot.png")
      if (try? await screenshot(
        .init(
          windowID: windowID,
          outputPath: screenshotURL.path,
          format: .png,
          quality: nil,
          maxImageDimension: currentMaxImageDimension(),
          cacheKey: nil
        )
      )) != nil {
        screenshotPath = screenshotURL.path
      }
      if let marker {
        let markerURL = turn.directory.appendingPathComponent("click.png")
        if (try? await writeDebugClickImage(windowID: windowID, point: marker, outputPath: markerURL.path)) != nil {
          markerPath = markerURL.path
        }
      }
    }
    try? recorder.finishTurn(
      turn,
      .init(
        method: method,
        request: request,
        result: result,
        screenshotPath: screenshotPath,
        markerPath: markerPath
      )
    )
  }

  private func replayRecording(
    _ request: SupatermComputerUseRecordingRequest
  ) async throws -> SupatermComputerUseRecordingResult {
    let requests = try recorder.recordedRequests(directory: request.directory)
    let wasSuppressed = recordingSuppressed
    recordingSuppressed = true
    var succeeded = 0
    var failed = 0
    for recordedRequest in requests {
      do {
        try await performRecorded(recordedRequest)
        succeeded += 1
      } catch {
        failed += 1
        if !request.keepGoing {
          recordingSuppressed = wasSuppressed
          throw error
        }
      }
      let delayMilliseconds = max(0, request.delayMilliseconds)
      if delayMilliseconds > 0 {
        try? await Task.sleep(nanoseconds: UInt64(delayMilliseconds) * 1_000_000)
      }
    }
    recordingSuppressed = wasSuppressed
    return .init(
      active: recorder.isActive,
      directory: request.directory ?? recorder.currentDirectoryPath,
      turns: requests.count,
      succeeded: succeeded,
      failed: failed
    )
  }

  private func performRecorded(_ request: SupatermSocketRequest) async throws {
    switch request.method {
    case SupatermSocketMethod.computerUseClick:
      _ = try await click(request.decodeParams(SupatermComputerUseClickRequest.self))
    case SupatermSocketMethod.computerUseType:
      _ = try await type(request.decodeParams(SupatermComputerUseTypeRequest.self))
    case SupatermSocketMethod.computerUseKey:
      _ = try await key(request.decodeParams(SupatermComputerUseKeyRequest.self))
    case SupatermSocketMethod.computerUseHotkey:
      _ = try await hotkey(request.decodeParams(SupatermComputerUseHotkeyRequest.self))
    case SupatermSocketMethod.computerUseScroll:
      _ = try await scroll(request.decodeParams(SupatermComputerUseScrollRequest.self))
    case SupatermSocketMethod.computerUseSetValue:
      _ = try await setValue(request.decodeParams(SupatermComputerUseSetValueRequest.self))
    case SupatermSocketMethod.computerUsePage:
      _ = try await page(request.decodeParams(SupatermComputerUsePageRequest.self))
    default:
      throw ComputerUseError.pageUnsupported("Recording cannot replay \(request.method).")
    }
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

  private func currentMaxImageDimension() -> Int {
    @Shared(.supatermSettings) var supatermSettings = .default
    return max(0, supatermSettings.computerUseMaxImageDimension)
  }

  private func snapshotJavaScript(
    _ request: SupatermComputerUseSnapshotRequest
  ) async -> SupatermComputerUseSnapshotJavaScriptResult? {
    guard let javascript = request.javascript?.trimmingCharacters(in: .whitespacesAndNewlines),
      !javascript.isEmpty
    else {
      return nil
    }
    do {
      return try await pageRuntime.evaluateSnapshotJavaScript(
        javascript,
        pid: request.pid,
        windowID: request.windowID
      )
    } catch {
      return .init(ok: false, error: error.localizedDescription)
    }
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

  private func screenshot(
    _ request: ScreenshotCaptureRequest
  ) async throws
    -> SupatermComputerUseScreenshot?
  {
    let capture: (image: CGImage, scale: Double)
    do {
      capture = try await windowImage(windowID: request.windowID)
    } catch {
      if request.outputPath != nil {
        throw ComputerUseError.screenRecordingPermissionMissing
      }
      return nil
    }
    let prepared = resizedImage(capture.image, maxImageDimension: request.maxImageDimension)
    if let cacheKey = request.cacheKey {
      resizeRatios[cacheKey] = prepared.snapshotToNativeRatio
    }

    if let outputPath = request.outputPath {
      let url = URL(fileURLWithPath: NSString(string: outputPath).expandingTildeInPath)
      try writeImage(prepared.image, to: url, format: request.format, quality: request.quality)
      return .init(
        path: url.path,
        width: prepared.image.width,
        height: prepared.image.height,
        originalWidth: capture.image.width,
        originalHeight: capture.image.height,
        scale: capture.scale
      )
    }

    return .init(
      path: nil,
      width: prepared.image.width,
      height: prepared.image.height,
      originalWidth: capture.image.width,
      originalHeight: capture.image.height,
      scale: capture.scale
    )
  }

  private func windowImage(windowID: UInt32) async throws -> (image: CGImage, scale: Double) {
    let content = try await SCShareableContent.excludingDesktopWindows(
      false, onScreenWindowsOnly: true)

    guard let window = content.windows.first(where: { $0.windowID == CGWindowID(windowID) }) else {
      throw ComputerUseError.windowNotFound(windowID)
    }

    let filter = SCContentFilter(desktopIndependentWindow: window)
    let configuration = SCStreamConfiguration()
    let scale = CGFloat(filter.pointPixelScale)
    configuration.width = Int(max(1, ceil(window.frame.width * scale)))
    configuration.height = Int(max(1, ceil(window.frame.height * scale)))
    configuration.showsCursor = false
    configuration.scalesToFit = true
    configuration.ignoreShadowsSingleWindow = true

    return (
      image: try await captureImage(filter: filter, configuration: configuration),
      scale: Double(scale)
    )
  }

  private func mainDisplayImage() async throws -> CGImage {
    let content = try await SCShareableContent.excludingDesktopWindows(
      false,
      onScreenWindowsOnly: true
    )
    guard let display = content.displays.first else {
      throw ComputerUseError.screenRecordingPermissionMissing
    }
    let filter = SCContentFilter(display: display, excludingWindows: [])
    let configuration = SCStreamConfiguration()
    configuration.width = display.width
    configuration.height = display.height
    configuration.showsCursor = true
    configuration.scalesToFit = true
    return try await captureImage(filter: filter, configuration: configuration)
  }

  private func resizedImage(
    _ image: CGImage,
    maxImageDimension: Int
  ) -> (image: CGImage, snapshotToNativeRatio: Double) {
    let largest = max(image.width, image.height)
    guard maxImageDimension > 0, largest > maxImageDimension else {
      return (image, 1)
    }
    let ratio = Double(largest) / Double(maxImageDimension)
    let width = max(1, Int((Double(image.width) / ratio).rounded()))
    let height = max(1, Int((Double(image.height) / ratio).rounded()))
    guard
      let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      )
    else {
      return (image, 1)
    }
    context.interpolationQuality = .high
    context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
    guard let resized = context.makeImage() else {
      return (image, 1)
    }
    return (resized, ratio)
  }

  private func writeImage(
    _ image: CGImage,
    to url: URL,
    format: SupatermComputerUseImageFormat,
    quality: Double?
  ) throws {
    try FileManager.default.createDirectory(
      at: url.deletingLastPathComponent(),
      withIntermediateDirectories: true,
      attributes: nil
    )
    let type: CFString
    switch format {
    case .png:
      type = "public.png" as CFString
    case .jpeg:
      type = "public.jpeg" as CFString
    }
    guard let destination = CGImageDestinationCreateWithURL(url as CFURL, type, 1, nil) else {
      throw ComputerUseError.imageWriteFailed(url.path)
    }
    var properties: [CFString: Any] = [:]
    if format == .jpeg, let quality {
      properties[kCGImageDestinationLossyCompressionQuality] = min(1, max(0, quality))
    }
    CGImageDestinationAddImage(destination, image, properties as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      throw ComputerUseError.imageWriteFailed(url.path)
    }
  }

  private func writeDebugClickImage(
    windowID: UInt32,
    point: CGPoint,
    outputPath: String
  ) async throws {
    let capture = try await windowImage(windowID: windowID)
    let prepared = resizedImage(capture.image, maxImageDimension: currentMaxImageDimension())
    guard
      let context = CGContext(
        data: nil,
        width: prepared.image.width,
        height: prepared.image.height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
      )
    else {
      throw ComputerUseError.imageWriteFailed(outputPath)
    }
    context.draw(
      prepared.image,
      in: CGRect(x: 0, y: 0, width: prepared.image.width, height: prepared.image.height)
    )
    context.setStrokeColor(NSColor.systemRed.cgColor)
    context.setLineWidth(4)
    let radius = 18.0
    context.strokeEllipse(
      in: CGRect(x: point.x - radius, y: point.y - radius, width: radius * 2, height: radius * 2)
    )
    context.move(to: CGPoint(x: point.x - radius * 1.5, y: point.y))
    context.addLine(to: CGPoint(x: point.x + radius * 1.5, y: point.y))
    context.move(to: CGPoint(x: point.x, y: point.y - radius * 1.5))
    context.addLine(to: CGPoint(x: point.x, y: point.y + radius * 1.5))
    context.strokePath()
    guard let image = context.makeImage() else {
      throw ComputerUseError.imageWriteFailed(outputPath)
    }
    let url = URL(fileURLWithPath: NSString(string: outputPath).expandingTildeInPath)
    try writeImage(image, to: url, format: .png, quality: nil)
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
          targetPid: request.pid,
          activity: cursorActivity(request: request, element: element)
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
      request: request,
      activity: cursorActivity(request: request, element: element)
    )
  }

  private func postClick(
    point: CGPoint,
    request: SupatermComputerUseClickRequest,
    preparedCursor: ComputerUsePreparedCursor? = nil,
    activity: String? = nil
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
        targetPid: request.pid,
        activity: activity ?? cursorActivity(request: request, element: nil)
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
    targetPid: Int,
    activity: String
  ) async -> ComputerUsePreparedCursor? {
    @Shared(.supatermSettings) var supatermSettings = .default
    return await cursorOverlay.prepareClick(
      .init(
        point: point,
        enabled: supatermSettings.computerUseShowAgentCursor,
        alwaysFloat: supatermSettings.computerUseAlwaysFloatAgentCursor,
        activity: activity,
        targetPid: pid_t(targetPid),
        targetWindowID: windowID,
        motion: supatermSettings.computerUseCursorMotion
      )
    )
  }

  private func cursorActivity(
    request: SupatermComputerUseClickRequest,
    element: AXUIElement?
  ) -> String {
    let verb = cursorClickVerb(request)
    guard let target = element.flatMap(cursorElementName) else {
      return "\(verb) point"
    }
    return "\(verb) \(target)"
  }

  private func cursorClickVerb(_ request: SupatermComputerUseClickRequest) -> String {
    switch request.action {
    case .showMenu:
      return "Opening menu"
    case .pick:
      return "Picking"
    case .confirm:
      return "Confirming"
    case .cancel:
      return "Canceling"
    case .open:
      return "Opening"
    case .press:
      break
    }

    if request.button == .right {
      return "Right-clicking"
    }
    if request.button == .middle {
      return "Middle-clicking"
    }
    switch request.count {
    case 2:
      return "Double-clicking"
    case 3:
      return "Triple-clicking"
    default:
      return "Clicking"
    }
  }

  private func cursorElementName(_ element: AXUIElement) -> String? {
    let candidates = [
      axString(element, kAXDescriptionAttribute as CFString),
      axString(element, kAXTitleAttribute as CFString),
      axString(element, kAXValueAttribute as CFString),
      axString(element, kAXIdentifierAttribute as CFString),
    ]
    for candidate in candidates {
      if let cleaned = cleanedCursorLabel(candidate) {
        return cleaned
      }
    }
    return axString(element, kAXRoleAttribute as CFString).flatMap(cursorRoleName)
  }

  private func cleanedCursorLabel(_ value: String?) -> String? {
    guard let value else { return nil }
    let cleaned =
      value
      .replacingOccurrences(of: "\u{200e}", with: "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    return cleaned.isEmpty ? nil : cleaned
  }

  private func cursorRoleName(_ role: String) -> String? {
    let normalized =
      role
      .replacingOccurrences(of: "AX", with: "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalized.isEmpty else { return nil }
    return normalized.lowercased()
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
  ) async throws -> SupatermComputerUseActionResult {
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
    if bundleID(for: request.pid) == "com.apple.Safari" {
      switch try await pageRuntime.setSafariSelectValue(request.value, windowID: request.windowID) {
      case .selected:
        return .init(ok: true, dispatch: "apple_events")
      case .notFound(let available):
        return .init(
          ok: false,
          dispatch: "apple_events",
          warning: "No matching option found. Available: \(available.joined(separator: ", "))"
        )
      }
    }
    throw ComputerUseError.actionUnsupported(request.elementIndex, "select_option")
  }

  private func bundleID(for pid: Int) -> String? {
    NSWorkspace.shared.runningApplications
      .first { Int($0.processIdentifier) == pid }?
      .bundleIdentifier
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

  private func screenPoint(
    windowPixel: CGPoint,
    pid: Int,
    windowID: UInt32,
    fromZoom: Bool = false
  ) throws -> CGPoint {
    guard let window = windowInfo(windowID: windowID, pid: pid) else {
      throw ComputerUseError.windowNotFound(windowID)
    }
    let scale = backingScale(for: window.window.frame)
    let key = CacheKey(pid: pid, windowID: windowID)
    let nativePixel: CGPoint
    if fromZoom {
      guard let context = zoomContexts[key] else {
        throw ComputerUseError.snapshotRequired
      }
      nativePixel = .init(
        x: context.source.origin.x + windowPixel.x,
        y: context.source.origin.y + windowPixel.y
      )
    } else {
      let ratio = resizeRatios[key] ?? 1
      nativePixel = .init(x: windowPixel.x * ratio, y: windowPixel.y * ratio)
    }
    return .init(
      x: window.window.frame.x + nativePixel.x / scale,
      y: window.window.frame.y + nativePixel.y / scale
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
