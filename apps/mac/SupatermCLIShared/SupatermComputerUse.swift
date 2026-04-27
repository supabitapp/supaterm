import Foundation

public enum SupatermComputerUsePermissionValue: String, Codable, Equatable, Sendable {
  case granted
  case missing
}

public struct SupatermComputerUsePermissionsResult: Codable, Equatable, Sendable {
  public let accessibility: SupatermComputerUsePermissionValue
  public let screenRecording: SupatermComputerUsePermissionValue

  public init(
    accessibility: SupatermComputerUsePermissionValue,
    screenRecording: SupatermComputerUsePermissionValue
  ) {
    self.accessibility = accessibility
    self.screenRecording = screenRecording
  }
}

public struct SupatermComputerUseRect: Codable, Equatable, Sendable {
  public let x: Double
  public let y: Double
  public let width: Double
  public let height: Double

  public init(
    x: Double,
    y: Double,
    width: Double,
    height: Double
  ) {
    self.x = x
    self.y = y
    self.width = width
    self.height = height
  }
}

public struct SupatermComputerUseApp: Codable, Equatable, Identifiable, Sendable {
  public let pid: Int
  public let bundleID: String?
  public let name: String
  public let isActive: Bool

  public var id: Int {
    pid
  }

  public init(
    pid: Int,
    bundleID: String?,
    name: String,
    isActive: Bool
  ) {
    self.pid = pid
    self.bundleID = bundleID
    self.name = name
    self.isActive = isActive
  }
}

public struct SupatermComputerUseAppsResult: Codable, Equatable, Sendable {
  public let apps: [SupatermComputerUseApp]

  public init(apps: [SupatermComputerUseApp]) {
    self.apps = apps
  }
}

public struct SupatermComputerUseLaunchRequest: Codable, Equatable, Sendable {
  public let bundleID: String?
  public let name: String?
  public let urls: [String]
  public let arguments: [String]
  public let environment: [String: String]
  public let electronDebuggingPort: Int?
  public let webkitInspectorPort: Int?
  public let createsNewInstance: Bool

  public init(
    bundleID: String? = nil,
    name: String? = nil,
    urls: [String] = [],
    arguments: [String] = [],
    environment: [String: String] = [:],
    electronDebuggingPort: Int? = nil,
    webkitInspectorPort: Int? = nil,
    createsNewInstance: Bool = false
  ) {
    self.bundleID = bundleID
    self.name = name
    self.urls = urls
    self.arguments = arguments
    self.environment = environment
    self.electronDebuggingPort = electronDebuggingPort
    self.webkitInspectorPort = webkitInspectorPort
    self.createsNewInstance = createsNewInstance
  }
}

public struct SupatermComputerUseLaunchResult: Codable, Equatable, Sendable {
  public let pid: Int
  public let bundleID: String?
  public let name: String
  public let isActive: Bool
  public let windows: [SupatermComputerUseWindow]

  public init(
    pid: Int,
    bundleID: String?,
    name: String,
    isActive: Bool,
    windows: [SupatermComputerUseWindow]
  ) {
    self.pid = pid
    self.bundleID = bundleID
    self.name = name
    self.isActive = isActive
    self.windows = windows
  }
}

public struct SupatermComputerUseWindowsRequest: Codable, Equatable, Sendable {
  public let app: String?
  public let onScreenOnly: Bool

  public init(app: String? = nil, onScreenOnly: Bool = false) {
    self.app = app
    self.onScreenOnly = onScreenOnly
  }
}

public struct SupatermComputerUseWindow: Codable, Equatable, Identifiable, Sendable {
  public let id: UInt32
  public let pid: Int
  public let appName: String
  public let title: String?
  public let frame: SupatermComputerUseRect
  public let isOnScreen: Bool
  public let zIndex: Int
  public let layer: Int
  public let onCurrentSpace: Bool?
  public let spaceIDs: [UInt64]?

  public init(
    id: UInt32,
    pid: Int,
    appName: String,
    title: String?,
    frame: SupatermComputerUseRect,
    isOnScreen: Bool,
    zIndex: Int = 0,
    layer: Int = 0,
    onCurrentSpace: Bool? = nil,
    spaceIDs: [UInt64]? = nil
  ) {
    self.id = id
    self.pid = pid
    self.appName = appName
    self.title = title
    self.frame = frame
    self.isOnScreen = isOnScreen
    self.zIndex = zIndex
    self.layer = layer
    self.onCurrentSpace = onCurrentSpace
    self.spaceIDs = spaceIDs
  }
}

public struct SupatermComputerUseWindowsResult: Codable, Equatable, Sendable {
  public let windows: [SupatermComputerUseWindow]

  public init(windows: [SupatermComputerUseWindow]) {
    self.windows = windows
  }
}

public enum SupatermComputerUseSnapshotMode: String, Codable, CaseIterable, Sendable {
  case som
  case ax
  case vision
}

public struct SupatermComputerUseSnapshotRequest: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32
  public let imageOutputPath: String?
  public let query: String?
  public let mode: SupatermComputerUseSnapshotMode?
  public let javascript: String?

  public init(
    pid: Int,
    windowID: UInt32,
    imageOutputPath: String? = nil,
    query: String? = nil,
    mode: SupatermComputerUseSnapshotMode? = nil,
    javascript: String? = nil
  ) {
    self.pid = pid
    self.windowID = windowID
    self.imageOutputPath = imageOutputPath
    self.query = query
    self.mode = mode
    self.javascript = javascript
  }
}

public struct SupatermComputerUseScreenshot: Codable, Equatable, Sendable {
  public let path: String?
  public let width: Int
  public let height: Int
  public let originalWidth: Int
  public let originalHeight: Int
  public let scale: Double

  public init(
    path: String?,
    width: Int,
    height: Int,
    originalWidth: Int? = nil,
    originalHeight: Int? = nil,
    scale: Double = 1
  ) {
    self.path = path
    self.width = width
    self.height = height
    self.originalWidth = originalWidth ?? width
    self.originalHeight = originalHeight ?? height
    self.scale = scale
  }
}

public struct SupatermComputerUseElement: Codable, Equatable, Identifiable, Sendable {
  public let elementIndex: Int
  public let role: String
  public let title: String?
  public let value: String?
  public let description: String?
  public let identifier: String?
  public let help: String?
  public let frame: SupatermComputerUseRect?
  public let isEnabled: Bool?
  public let isFocused: Bool?
  public let actions: [String]

  public var id: Int {
    elementIndex
  }

  public var displayText: String? {
    title ?? value ?? description ?? identifier ?? help
  }

  public init(
    elementIndex: Int,
    role: String,
    title: String?,
    value: String?,
    description: String?,
    identifier: String?,
    help: String?,
    frame: SupatermComputerUseRect?,
    isEnabled: Bool?,
    isFocused: Bool?,
    actions: [String] = []
  ) {
    self.elementIndex = elementIndex
    self.role = role
    self.title = title
    self.value = value
    self.description = description
    self.identifier = identifier
    self.help = help
    self.frame = frame
    self.isEnabled = isEnabled
    self.isFocused = isFocused
    self.actions = actions
  }
}

public struct SupatermComputerUseSnapshotResult: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32
  public let frame: SupatermComputerUseRect?
  public let elements: [SupatermComputerUseElement]
  public let screenshot: SupatermComputerUseScreenshot?
  public let javascript: SupatermComputerUseSnapshotJavaScriptResult?

  public init(
    pid: Int,
    windowID: UInt32,
    frame: SupatermComputerUseRect?,
    elements: [SupatermComputerUseElement],
    screenshot: SupatermComputerUseScreenshot?,
    javascript: SupatermComputerUseSnapshotJavaScriptResult? = nil
  ) {
    self.pid = pid
    self.windowID = windowID
    self.frame = frame
    self.elements = elements
    self.screenshot = screenshot
    self.javascript = javascript
  }
}

public struct SupatermComputerUseClickRequest: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32
  public let elementIndex: Int?
  public let x: Double?
  public let y: Double?
  public let button: SupatermComputerUseClickButton
  public let count: Int
  public let modifiers: [SupatermComputerUseClickModifier]
  public let action: SupatermComputerUseClickAction
  public let fromZoom: Bool
  public let debugImageOutputPath: String?

  public init(
    pid: Int,
    windowID: UInt32,
    elementIndex: Int? = nil,
    x: Double? = nil,
    y: Double? = nil,
    button: SupatermComputerUseClickButton = .left,
    count: Int = 1,
    modifiers: [SupatermComputerUseClickModifier] = [],
    action: SupatermComputerUseClickAction = .press,
    fromZoom: Bool = false,
    debugImageOutputPath: String? = nil
  ) {
    self.pid = pid
    self.windowID = windowID
    self.elementIndex = elementIndex
    self.x = x
    self.y = y
    self.button = button
    self.count = count
    self.modifiers = modifiers
    self.action = action
    self.fromZoom = fromZoom
    self.debugImageOutputPath = debugImageOutputPath
  }
}

public enum SupatermComputerUseClickButton: String, Codable, CaseIterable, Sendable {
  case left
  case right
  case middle
}

public enum SupatermComputerUseClickModifier: String, Codable, CaseIterable, Sendable {
  case command
  case shift
  case option
  case control
  case function
}

public enum SupatermComputerUseClickAction: String, Codable, CaseIterable, Sendable {
  case press
  case showMenu = "show-menu"
  case pick
  case confirm
  case cancel
  case open
}

public struct SupatermComputerUseTypeRequest: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32?
  public let elementIndex: Int?
  public let text: String
  public let delayMilliseconds: Int

  public init(
    pid: Int,
    windowID: UInt32? = nil,
    elementIndex: Int? = nil,
    text: String,
    delayMilliseconds: Int = 30
  ) {
    self.pid = pid
    self.windowID = windowID
    self.elementIndex = elementIndex
    self.text = text
    self.delayMilliseconds = delayMilliseconds
  }
}

public enum SupatermComputerUseKeyModifier: String, Codable, CaseIterable, Sendable {
  case command
  case shift
  case option
  case control
  case function
}

public struct SupatermComputerUseKeyRequest: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32?
  public let elementIndex: Int?
  public let key: String
  public let modifiers: [SupatermComputerUseKeyModifier]

  public init(
    pid: Int,
    windowID: UInt32? = nil,
    elementIndex: Int? = nil,
    key: String,
    modifiers: [SupatermComputerUseKeyModifier] = []
  ) {
    self.pid = pid
    self.windowID = windowID
    self.elementIndex = elementIndex
    self.key = key
    self.modifiers = modifiers
  }
}

public enum SupatermComputerUseScrollDirection: String, Codable, CaseIterable, Sendable {
  case up
  case down
  case left
  case right
}

public enum SupatermComputerUseScrollUnit: String, Codable, CaseIterable, Sendable {
  case line
  case page
}

public struct SupatermComputerUseScrollRequest: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32
  public let elementIndex: Int?
  public let direction: SupatermComputerUseScrollDirection
  public let unit: SupatermComputerUseScrollUnit
  public let amount: Int

  public init(
    pid: Int,
    windowID: UInt32,
    elementIndex: Int? = nil,
    direction: SupatermComputerUseScrollDirection,
    unit: SupatermComputerUseScrollUnit = .line,
    amount: Int = 5
  ) {
    self.pid = pid
    self.windowID = windowID
    self.elementIndex = elementIndex
    self.direction = direction
    self.unit = unit
    self.amount = amount
  }
}

public struct SupatermComputerUseSetValueRequest: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32
  public let elementIndex: Int
  public let value: String

  public init(
    pid: Int,
    windowID: UInt32,
    elementIndex: Int,
    value: String
  ) {
    self.pid = pid
    self.windowID = windowID
    self.elementIndex = elementIndex
    self.value = value
  }
}

public enum SupatermComputerUsePageAction: String, Codable, CaseIterable, Sendable {
  case executeJavaScript = "execute-javascript"
  case getText = "get-text"
  case queryDOM = "query-dom"
  case enableJavaScriptAppleEvents = "enable-javascript-apple-events"
}

public enum SupatermComputerUsePageBrowser: String, Codable, CaseIterable, Sendable {
  case chrome
  case brave
  case edge
  case safari

  public var bundleID: String {
    switch self {
    case .chrome:
      return "com.google.Chrome"
    case .brave:
      return "com.brave.Browser"
    case .edge:
      return "com.microsoft.edgemac"
    case .safari:
      return "com.apple.Safari"
    }
  }
}

public struct SupatermComputerUsePageRequest: Codable, Equatable, Sendable {
  public let pid: Int?
  public let windowID: UInt32?
  public let action: SupatermComputerUsePageAction
  public let javascript: String?
  public let cssSelector: String?
  public let attributes: [String]
  public let browser: SupatermComputerUsePageBrowser?

  public init(
    pid: Int? = nil,
    windowID: UInt32? = nil,
    action: SupatermComputerUsePageAction,
    javascript: String? = nil,
    cssSelector: String? = nil,
    attributes: [String] = [],
    browser: SupatermComputerUsePageBrowser? = nil
  ) {
    self.pid = pid
    self.windowID = windowID
    self.action = action
    self.javascript = javascript
    self.cssSelector = cssSelector
    self.attributes = attributes
    self.browser = browser
  }
}

public struct SupatermComputerUsePageResult: Codable, Equatable, Sendable {
  public let action: SupatermComputerUsePageAction
  public let dispatch: String
  public let text: String?
  public let json: JSONValue?

  public init(
    action: SupatermComputerUsePageAction,
    dispatch: String,
    text: String? = nil,
    json: JSONValue? = nil
  ) {
    self.action = action
    self.dispatch = dispatch
    self.text = text
    self.json = json
  }
}

public struct SupatermComputerUseScreenSizeResult: Codable, Equatable, Sendable {
  public let width: Double
  public let height: Double
  public let scale: Double

  public init(width: Double, height: Double, scale: Double) {
    self.width = width
    self.height = height
    self.scale = scale
  }
}

public struct SupatermComputerUseCursorPositionResult: Codable, Equatable, Sendable {
  public let x: Double
  public let y: Double

  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
}

public struct SupatermComputerUseMoveCursorRequest: Codable, Equatable, Sendable {
  public let x: Double
  public let y: Double

  public init(x: Double, y: Double) {
    self.x = x
    self.y = y
  }
}

public enum SupatermComputerUseImageFormat: String, Codable, CaseIterable, Sendable {
  case png
  case jpeg
}

public struct SupatermComputerUseScreenshotRequest: Codable, Equatable, Sendable {
  public let windowID: UInt32?
  public let imageOutputPath: String
  public let format: SupatermComputerUseImageFormat
  public let quality: Double?

  public init(
    windowID: UInt32? = nil,
    imageOutputPath: String,
    format: SupatermComputerUseImageFormat = .png,
    quality: Double? = nil
  ) {
    self.windowID = windowID
    self.imageOutputPath = imageOutputPath
    self.format = format
    self.quality = quality
  }
}

public struct SupatermComputerUseZoomRequest: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32
  public let x: Double
  public let y: Double
  public let width: Double
  public let height: Double
  public let imageOutputPath: String

  public init(
    pid: Int,
    windowID: UInt32,
    x: Double,
    y: Double,
    width: Double,
    height: Double,
    imageOutputPath: String
  ) {
    self.pid = pid
    self.windowID = windowID
    self.x = x
    self.y = y
    self.width = width
    self.height = height
    self.imageOutputPath = imageOutputPath
  }
}

public struct SupatermComputerUseZoomResult: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32
  public let source: SupatermComputerUseRect
  public let screenshot: SupatermComputerUseScreenshot
  public let snapshotToNativeRatio: Double

  public init(
    pid: Int,
    windowID: UInt32,
    source: SupatermComputerUseRect,
    screenshot: SupatermComputerUseScreenshot,
    snapshotToNativeRatio: Double
  ) {
    self.pid = pid
    self.windowID = windowID
    self.source = source
    self.screenshot = screenshot
    self.snapshotToNativeRatio = snapshotToNativeRatio
  }
}

public struct SupatermComputerUseHotkeyRequest: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32?
  public let elementIndex: Int?
  public let keys: [String]

  public init(
    pid: Int,
    windowID: UInt32? = nil,
    elementIndex: Int? = nil,
    keys: [String]
  ) {
    self.pid = pid
    self.windowID = windowID
    self.elementIndex = elementIndex
    self.keys = keys
  }
}

public struct SupatermComputerUseSnapshotJavaScriptResult: Codable, Equatable, Sendable {
  public let ok: Bool
  public let dispatch: String?
  public let text: String?
  public let json: JSONValue?
  public let error: String?

  public init(
    ok: Bool,
    dispatch: String? = nil,
    text: String? = nil,
    json: JSONValue? = nil,
    error: String? = nil
  ) {
    self.ok = ok
    self.dispatch = dispatch
    self.text = text
    self.json = json
    self.error = error
  }
}

public struct SupatermComputerUseCursorMotion: Codable, Equatable, Sendable {
  public static let `default` = SupatermComputerUseCursorMotion()

  public let startHandle: Double
  public let endHandle: Double
  public let arcSize: Double
  public let arcFlow: Double
  public let spring: Double
  public let glideDurationMilliseconds: Int
  public let dwellAfterClickMilliseconds: Int
  public let idleHideMilliseconds: Int

  public init(
    startHandle: Double = 0.24,
    endHandle: Double = 0.76,
    arcSize: Double = 80,
    arcFlow: Double = 0.36,
    spring: Double = 0.16,
    glideDurationMilliseconds: Int = 220,
    dwellAfterClickMilliseconds: Int = 80,
    idleHideMilliseconds: Int = 900
  ) {
    self.startHandle = startHandle
    self.endHandle = endHandle
    self.arcSize = arcSize
    self.arcFlow = arcFlow
    self.spring = spring
    self.glideDurationMilliseconds = glideDurationMilliseconds
    self.dwellAfterClickMilliseconds = dwellAfterClickMilliseconds
    self.idleHideMilliseconds = idleHideMilliseconds
  }
}

public struct SupatermComputerUseCursorRequest: Codable, Equatable, Sendable {
  public let enabled: Bool?
  public let alwaysFloat: Bool?
  public let motion: SupatermComputerUseCursorMotion?
  public let startHandle: Double?
  public let endHandle: Double?
  public let arcSize: Double?
  public let arcFlow: Double?
  public let spring: Double?
  public let glideDurationMilliseconds: Int?
  public let dwellAfterClickMilliseconds: Int?
  public let idleHideMilliseconds: Int?

  public init(
    enabled: Bool? = nil,
    alwaysFloat: Bool? = nil,
    motion: SupatermComputerUseCursorMotion? = nil,
    startHandle: Double? = nil,
    endHandle: Double? = nil,
    arcSize: Double? = nil,
    arcFlow: Double? = nil,
    spring: Double? = nil,
    glideDurationMilliseconds: Int? = nil,
    dwellAfterClickMilliseconds: Int? = nil,
    idleHideMilliseconds: Int? = nil
  ) {
    self.enabled = enabled
    self.alwaysFloat = alwaysFloat
    self.motion = motion
    self.startHandle = startHandle
    self.endHandle = endHandle
    self.arcSize = arcSize
    self.arcFlow = arcFlow
    self.spring = spring
    self.glideDurationMilliseconds = glideDurationMilliseconds
    self.dwellAfterClickMilliseconds = dwellAfterClickMilliseconds
    self.idleHideMilliseconds = idleHideMilliseconds
  }
}

public struct SupatermComputerUseCursorResult: Codable, Equatable, Sendable {
  public let enabled: Bool
  public let alwaysFloat: Bool
  public let motion: SupatermComputerUseCursorMotion

  public init(
    enabled: Bool,
    alwaysFloat: Bool,
    motion: SupatermComputerUseCursorMotion
  ) {
    self.enabled = enabled
    self.alwaysFloat = alwaysFloat
    self.motion = motion
  }
}

public enum SupatermComputerUseRecordingAction: String, Codable, CaseIterable, Sendable {
  case start
  case stop
  case status
  case replay
  case render
}

public struct SupatermComputerUseRecordingRequest: Codable, Equatable, Sendable {
  public let action: SupatermComputerUseRecordingAction
  public let directory: String?
  public let outputPath: String?
  public let delayMilliseconds: Int
  public let keepGoing: Bool

  public init(
    action: SupatermComputerUseRecordingAction,
    directory: String? = nil,
    outputPath: String? = nil,
    delayMilliseconds: Int = 120,
    keepGoing: Bool = false
  ) {
    self.action = action
    self.directory = directory
    self.outputPath = outputPath
    self.delayMilliseconds = delayMilliseconds
    self.keepGoing = keepGoing
  }
}

public struct SupatermComputerUseRecordingResult: Codable, Equatable, Sendable {
  public let active: Bool
  public let directory: String?
  public let turns: Int
  public let succeeded: Int?
  public let failed: Int?
  public let renderedPath: String?

  public init(
    active: Bool,
    directory: String? = nil,
    turns: Int = 0,
    succeeded: Int? = nil,
    failed: Int? = nil,
    renderedPath: String? = nil
  ) {
    self.active = active
    self.directory = directory
    self.turns = turns
    self.succeeded = succeeded
    self.failed = failed
    self.renderedPath = renderedPath
  }
}

public struct SupatermComputerUseActionResult: Codable, Equatable, Sendable {
  public let ok: Bool
  public let dispatch: String
  public let warning: String?

  public init(
    ok: Bool,
    dispatch: String,
    warning: String? = nil
  ) {
    self.ok = ok
    self.dispatch = dispatch
    self.warning = warning
  }
}
