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

public struct SupatermComputerUseWindowsRequest: Codable, Equatable, Sendable {
  public let app: String?

  public init(app: String? = nil) {
    self.app = app
  }
}

public struct SupatermComputerUseWindow: Codable, Equatable, Identifiable, Sendable {
  public let id: UInt32
  public let pid: Int
  public let appName: String
  public let title: String?
  public let frame: SupatermComputerUseRect
  public let isOnScreen: Bool

  public init(
    id: UInt32,
    pid: Int,
    appName: String,
    title: String?,
    frame: SupatermComputerUseRect,
    isOnScreen: Bool
  ) {
    self.id = id
    self.pid = pid
    self.appName = appName
    self.title = title
    self.frame = frame
    self.isOnScreen = isOnScreen
  }
}

public struct SupatermComputerUseWindowsResult: Codable, Equatable, Sendable {
  public let windows: [SupatermComputerUseWindow]

  public init(windows: [SupatermComputerUseWindow]) {
    self.windows = windows
  }
}

public struct SupatermComputerUseSnapshotRequest: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32
  public let imageOutputPath: String?

  public init(
    pid: Int,
    windowID: UInt32,
    imageOutputPath: String? = nil
  ) {
    self.pid = pid
    self.windowID = windowID
    self.imageOutputPath = imageOutputPath
  }
}

public struct SupatermComputerUseScreenshot: Codable, Equatable, Sendable {
  public let path: String?
  public let width: Int
  public let height: Int

  public init(
    path: String?,
    width: Int,
    height: Int
  ) {
    self.path = path
    self.width = width
    self.height = height
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
    isFocused: Bool?
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

  public init(
    pid: Int,
    windowID: UInt32,
    elementIndex: Int? = nil,
    x: Double? = nil,
    y: Double? = nil
  ) {
    self.pid = pid
    self.windowID = windowID
    self.elementIndex = elementIndex
    self.x = x
    self.y = y
  }
}

public struct SupatermComputerUseTypeRequest: Codable, Equatable, Sendable {
  public let pid: Int
  public let text: String

  public init(
    pid: Int,
    text: String
  ) {
    self.pid = pid
    self.text = text
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
  public let key: String
  public let modifiers: [SupatermComputerUseKeyModifier]

  public init(
    pid: Int,
    key: String,
    modifiers: [SupatermComputerUseKeyModifier] = []
  ) {
    self.pid = pid
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

public struct SupatermComputerUseScrollRequest: Codable, Equatable, Sendable {
  public let pid: Int
  public let windowID: UInt32
  public let direction: SupatermComputerUseScrollDirection
  public let amount: Int

  public init(
    pid: Int,
    windowID: UInt32,
    direction: SupatermComputerUseScrollDirection,
    amount: Int = 5
  ) {
    self.pid = pid
    self.windowID = windowID
    self.direction = direction
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

  public init(
    ok: Bool,
    dispatch: String
  ) {
    self.ok = ok
    self.dispatch = dispatch
  }
}
