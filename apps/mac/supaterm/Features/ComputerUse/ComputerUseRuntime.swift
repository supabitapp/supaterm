import AppKit
import ApplicationServices
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit
import Sharing
import SupatermCLIShared
import SupatermSupport

@MainActor
public final class ComputerUseRuntime: @unchecked Sendable {
  public static let shared = ComputerUseRuntime()

  private struct CacheKey: Hashable {
    let pid: Int
    let windowID: UInt32
  }

  private let cursorOverlay = ComputerUseCursorOverlay()
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

  public func windows(
    _ request: SupatermComputerUseWindowsRequest
  ) -> SupatermComputerUseWindowsResult {
    let pidFilter = pidFilter(for: request.app)
    let windows = windowInfos()
      .filter { info in
        guard let pidFilter else { return true }
        return info.pid == pidFilter
      }
      .map(\.window)
      .sorted {
        if $0.pid == $1.pid {
          return $0.id < $1.id
        }
        return $0.appName.localizedStandardCompare($1.appName) == .orderedAscending
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

    let appElement = AXUIElementCreateApplication(pid_t(request.pid))
    let targetWindow = matchingWindow(in: appElement, frame: windowInfo.window.frame)
    let root = targetWindow ?? appElement
    var elements: [SupatermComputerUseElement] = []
    var cache: [Int: AXUIElement] = [:]
    collectElements(root, elements: &elements, cache: &cache, nextIndex: 1, depth: 0)
    elementCache[.init(pid: request.pid, windowID: request.windowID)] = cache

    let screenshot = try await screenshot(
      windowID: request.windowID, outputPath: request.imageOutputPath)
    return .init(
      pid: request.pid,
      windowID: request.windowID,
      frame: windowInfo.window.frame,
      elements: elements,
      screenshot: screenshot
    )
  }

  public func click(
    _ request: SupatermComputerUseClickRequest
  ) throws -> SupatermComputerUseActionResult {
    if let elementIndex = request.elementIndex {
      let element = try cachedElement(
        pid: request.pid, windowID: request.windowID, elementIndex: elementIndex)
      return try clickElement(element, request: request)
    }

    guard let x = request.x, let y = request.y else {
      throw ComputerUseError.invalidClickTarget
    }
    return try postClick(
      point: try screenPoint(
        windowPixel: .init(x: x, y: y), pid: request.pid, windowID: request.windowID),
      request: request
    )
  }

  public func type(
    _ request: SupatermComputerUseTypeRequest
  ) throws -> SupatermComputerUseActionResult {
    let source = CGEventSource(stateID: .hidSystemState)
    var chars = Array(request.text.utf16)
    guard !chars.isEmpty else {
      return .init(ok: true, dispatch: "pid_event")
    }
    let keyDown = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true)
    let keyUp = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
    guard let keyDown, let keyUp else {
      throw ComputerUseError.unsupportedBackgroundTarget
    }
    keyDown.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: &chars)
    keyUp.keyboardSetUnicodeString(stringLength: chars.count, unicodeString: &chars)
    keyDown.postToPid(pid_t(request.pid))
    keyUp.postToPid(pid_t(request.pid))
    return .init(ok: true, dispatch: "pid_event")
  }

  public func key(
    _ request: SupatermComputerUseKeyRequest
  ) throws -> SupatermComputerUseActionResult {
    guard let keyCode = keyCode(for: request.key) else {
      throw ComputerUseError.keyUnsupported(request.key)
    }
    let flags = eventFlags(for: request.modifiers)
    let source = CGEventSource(stateID: .hidSystemState)
    guard
      let keyDown = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: true),
      let keyUp = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: false)
    else {
      throw ComputerUseError.unsupportedBackgroundTarget
    }
    keyDown.flags = flags
    keyUp.flags = flags
    keyDown.postToPid(pid_t(request.pid))
    keyUp.postToPid(pid_t(request.pid))
    return .init(ok: true, dispatch: "pid_event")
  }

  public func scroll(
    _ request: SupatermComputerUseScrollRequest
  ) throws -> SupatermComputerUseActionResult {
    let delta = Int32(max(1, request.amount))
    let wheel1: Int32
    let wheel2: Int32
    switch request.direction {
    case .up:
      wheel1 = delta
      wheel2 = 0
    case .down:
      wheel1 = -delta
      wheel2 = 0
    case .left:
      wheel1 = 0
      wheel2 = delta
    case .right:
      wheel1 = 0
      wheel2 = -delta
    }
    guard
      let event = CGEvent(
        scrollWheelEvent2Source: CGEventSource(stateID: .hidSystemState),
        units: .line,
        wheelCount: 2,
        wheel1: wheel1,
        wheel2: wheel2,
        wheel3: 0
      )
    else {
      throw ComputerUseError.unsupportedBackgroundTarget
    }
    event.postToPid(pid_t(request.pid))
    return .init(ok: true, dispatch: "pid_event")
  }

  public func setValue(
    _ request: SupatermComputerUseSetValueRequest
  ) throws -> SupatermComputerUseActionResult {
    let element = try cachedElement(
      pid: request.pid,
      windowID: request.windowID,
      elementIndex: request.elementIndex
    )
    let result = AXUIElementSetAttributeValue(
      element, kAXValueAttribute as CFString, request.value as CFTypeRef)
    guard result == .success else {
      throw ComputerUseError.unsupportedBackgroundTarget
    }
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

  private func windowInfos() -> [ComputerUseWindowInfo] {
    guard
      let array = CGWindowListCopyWindowInfo(
        [.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
        as? [[String: Any]]
    else {
      return []
    }
    return array.compactMap(ComputerUseWindowInfo.init)
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

  private func matchingWindow(
    in appElement: AXUIElement,
    frame: SupatermComputerUseRect
  ) -> AXUIElement? {
    axArray(appElement, kAXWindowsAttribute as CFString)?
      .min { lhs, rhs in
        frameDistance(elementFrame(lhs), frame) < frameDistance(elementFrame(rhs), frame)
      }
  }

  private func collectElements(
    _ element: AXUIElement,
    elements: inout [SupatermComputerUseElement],
    cache: inout [Int: AXUIElement],
    nextIndex: Int,
    depth: Int
  ) {
    guard depth <= 8, elements.count < 300 else { return }
    let index = elements.count + nextIndex
    cache[index] = element
    elements.append(
      .init(
        elementIndex: index,
        role: axString(element, kAXRoleAttribute as CFString) ?? "unknown",
        title: axString(element, kAXTitleAttribute as CFString),
        value: axString(element, kAXValueAttribute as CFString),
        description: axString(element, kAXDescriptionAttribute as CFString),
        identifier: axString(element, kAXIdentifierAttribute as CFString),
        help: axString(element, kAXHelpAttribute as CFString),
        frame: elementFrame(element).map(rect),
        isEnabled: axBool(element, kAXEnabledAttribute as CFString),
        isFocused: axBool(element, kAXFocusedAttribute as CFString)
      )
    )

    for child in axArray(element, kAXChildrenAttribute as CFString) ?? [] {
      collectElements(
        child, elements: &elements, cache: &cache, nextIndex: nextIndex, depth: depth + 1)
    }
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
      return .init(path: url.path, width: image.width, height: image.height)
    }

    return .init(path: nil, width: image.width, height: image.height)
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
  ) throws -> SupatermComputerUseActionResult {
    let point = elementTargetPoint(element)
    if request.button == .left, request.count == 1, request.modifiers.isEmpty,
      performAction(kAXPressAction as CFString, on: element)
    {
      if let point {
        moveCursor(to: point, aboveWindowID: request.windowID)
      }
      return .init(ok: true, dispatch: ComputerUseMouseDispatch.accessibility.rawValue)
    }
    if request.button == .right, request.count == 1, request.modifiers.isEmpty,
      performAction(kAXShowMenuAction as CFString, on: element)
    {
      if let point {
        moveCursor(to: point, aboveWindowID: request.windowID)
      }
      return .init(ok: true, dispatch: ComputerUseMouseDispatch.accessibility.rawValue)
    }
    guard let point else {
      throw ComputerUseError.unsupportedBackgroundTarget
    }
    return try postClick(
      point: point,
      request: request
    )
  }

  private func postClick(
    point: CGPoint,
    request: SupatermComputerUseClickRequest
  ) throws -> SupatermComputerUseActionResult {
    guard let windowInfo = windowInfo(windowID: request.windowID, pid: request.pid) else {
      throw ComputerUseError.windowNotFound(request.windowID)
    }
    moveCursor(to: point, aboveWindowID: request.windowID)
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
    return .init(ok: true, dispatch: dispatch.rawValue)
  }

  private func moveCursor(to point: CGPoint, aboveWindowID windowID: UInt32) {
    @Shared(.supatermSettings) var supatermSettings = .default
    cursorOverlay.move(
      to: point,
      enabled: supatermSettings.computerUseShowAgentCursor,
      targetWindowID: windowID
    )
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
      current = unsafeBitCast(parent, to: AXUIElement.self)
    }
    return false
  }

  private func performAction(_ action: CFString, on element: AXUIElement) -> Bool {
    AXUIElementPerformAction(element, action) == .success
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

  private func frameDistance(_ lhs: CGRect?, _ rhs: SupatermComputerUseRect) -> Double {
    guard let lhs else { return .greatestFiniteMagnitude }
    return abs(lhs.origin.x - rhs.x) + abs(lhs.origin.y - rhs.y) + abs(lhs.width - rhs.width)
      + abs(lhs.height - rhs.height)
  }

  private func keyCode(for key: String) -> CGKeyCode? {
    let normalized = key.lowercased()
    if let mapped = namedKeyCodes[normalized] {
      return mapped
    }
    if normalized.count == 1, let character = normalized.first {
      return characterKeyCodes[character]
    }
    return nil
  }

  private func eventFlags(for modifiers: [SupatermComputerUseKeyModifier]) -> CGEventFlags {
    modifiers.reduce(into: []) { flags, modifier in
      switch modifier {
      case .command:
        flags.insert(.maskCommand)
      case .shift:
        flags.insert(.maskShift)
      case .option:
        flags.insert(.maskAlternate)
      case .control:
        flags.insert(.maskControl)
      }
    }
  }

  private let namedKeyCodes: [String: CGKeyCode] = [
    "return": 36,
    "enter": 36,
    "tab": 48,
    "space": 49,
    "delete": 51,
    "escape": 53,
    "esc": 53,
    "left": 123,
    "right": 124,
    "down": 125,
    "up": 126,
  ]

  private let characterKeyCodes: [Character: CGKeyCode] = [
    "a": 0,
    "s": 1,
    "d": 2,
    "f": 3,
    "h": 4,
    "g": 5,
    "z": 6,
    "x": 7,
    "c": 8,
    "v": 9,
    "b": 11,
    "q": 12,
    "w": 13,
    "e": 14,
    "r": 15,
    "y": 16,
    "t": 17,
    "1": 18,
    "2": 19,
    "3": 20,
    "4": 21,
    "6": 22,
    "5": 23,
    "=": 24,
    "9": 25,
    "7": 26,
    "-": 27,
    "8": 28,
    "0": 29,
    "]": 30,
    "o": 31,
    "u": 32,
    "[": 33,
    "i": 34,
    "p": 35,
    "l": 37,
    "j": 38,
    "'": 39,
    "k": 40,
    ";": 41,
    "\\": 42,
    ",": 43,
    "/": 44,
    "n": 45,
    "m": 46,
    ".": 47,
    "`": 50,
  ]
}

private struct ComputerUseWindowInfo {
  let window: SupatermComputerUseWindow
  let pid: Int

  init?(_ dictionary: [String: Any]) {
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
    self.pid = pid
    self.window = .init(
      id: windowID,
      pid: pid,
      appName: appName,
      title: title?.isEmpty == true ? nil : title,
      frame: .init(x: x, y: y, width: width, height: height),
      isOnScreen: isOnScreen
    )
  }
}
