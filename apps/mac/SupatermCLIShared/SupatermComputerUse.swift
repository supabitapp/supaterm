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
  public let createsNewInstance: Bool

  public init(
    bundleID: String? = nil,
    name: String? = nil,
    urls: [String] = [],
    arguments: [String] = [],
    environment: [String: String] = [:],
    createsNewInstance: Bool = false
  ) {
    self.bundleID = bundleID
    self.name = name
    self.urls = urls
    self.arguments = arguments
    self.environment = environment
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

  public init(
    pid: Int,
    windowID: UInt32,
    imageOutputPath: String? = nil,
    query: String? = nil,
    mode: SupatermComputerUseSnapshotMode? = nil
  ) {
    self.pid = pid
    self.windowID = windowID
    self.imageOutputPath = imageOutputPath
    self.query = query
    self.mode = mode
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

  public init(
    pid: Int,
    windowID: UInt32,
    frame: SupatermComputerUseRect?,
    elements: [SupatermComputerUseElement],
    screenshot: SupatermComputerUseScreenshot?
  ) {
    self.pid = pid
    self.windowID = windowID
    self.frame = frame
    self.elements = elements
    self.screenshot = screenshot
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

  public init(
    pid: Int,
    windowID: UInt32,
    elementIndex: Int? = nil,
    x: Double? = nil,
    y: Double? = nil,
    button: SupatermComputerUseClickButton = .left,
    count: Int = 1,
    modifiers: [SupatermComputerUseClickModifier] = [],
    action: SupatermComputerUseClickAction = .press
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
