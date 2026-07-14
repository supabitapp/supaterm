import Foundation
import SupatermCLIShared
import SupatermSupport

public struct TerminalCreateTabRequest: Equatable, Sendable {
  public enum Target: Equatable, Sendable {
    case contextPane(UUID)
    case project(windowIndex: Int, spaceIndex: Int, projectIndex: Int)
  }

  public let startupCommand: String?
  public let cwd: String?
  public let focus: Bool
  public let inheritingFromSurfaceID: UUID?
  public let target: Target

  public init(
    startupCommand: String?,
    cwd: String?,
    focus: Bool,
    inheritingFromSurfaceID: UUID? = nil,
    target: Target
  ) {
    self.startupCommand = startupCommand
    self.cwd = cwd
    self.focus = focus
    self.inheritingFromSurfaceID = inheritingFromSurfaceID
    self.target = target
  }
}

public struct TerminalCreatePaneRequest: Equatable, Sendable {
  public enum Target: Equatable, Sendable {
    case contextPane(UUID)
    case pane(windowIndex: Int, spaceIndex: Int, projectIndex: Int, tabIndex: Int, paneIndex: Int)
    case tab(windowIndex: Int, spaceIndex: Int, projectIndex: Int, tabIndex: Int)
  }

  public let startupCommand: String?
  public let cwd: String?
  public let direction: SupatermPaneDirection
  public let focus: Bool
  public let equalize: Bool
  public let target: Target

  public init(
    startupCommand: String?,
    cwd: String? = nil,
    direction: SupatermPaneDirection,
    focus: Bool,
    equalize: Bool,
    target: Target
  ) {
    self.startupCommand = startupCommand
    self.cwd = cwd
    self.direction = direction
    self.focus = focus
    self.equalize = equalize
    self.target = target
  }
}

public struct TerminalNotifyRequest: Equatable, Sendable {
  public enum Target: Equatable, Sendable {
    case contextPane(UUID)
    case pane(windowIndex: Int, spaceIndex: Int, projectIndex: Int, tabIndex: Int, paneIndex: Int)
    case tab(windowIndex: Int, spaceIndex: Int, projectIndex: Int, tabIndex: Int)
  }

  public let allowDesktopNotificationWhenAgentActive: Bool
  public let body: String
  public let subtitle: String
  public let target: Target
  public let title: String?

  public init(
    body: String,
    subtitle: String,
    target: Target,
    title: String?,
    allowDesktopNotificationWhenAgentActive: Bool = false
  ) {
    self.allowDesktopNotificationWhenAgentActive = allowDesktopNotificationWhenAgentActive
    self.body = body
    self.subtitle = subtitle
    self.target = target
    self.title = title
  }
}

public enum TerminalSpaceTarget: Equatable, Sendable {
  case contextPane(UUID)
  case space(windowIndex: Int, spaceIndex: Int)
}

public enum TerminalProjectTarget: Equatable, Sendable {
  case contextPane(UUID)
  case project(windowIndex: Int, spaceIndex: Int, projectIndex: Int)
}

public struct TerminalCreateProjectRequest: Equatable, Sendable {
  public let directoryURL: URL
  public let focus: Bool
  public let target: TerminalSpaceTarget

  public init(directoryURL: URL, focus: Bool, target: TerminalSpaceTarget) {
    self.directoryURL = directoryURL
    self.focus = focus
    self.target = target
  }
}

public enum TerminalTabTarget: Equatable, Sendable {
  case contextPane(UUID)
  case tab(windowIndex: Int, spaceIndex: Int, projectIndex: Int, tabIndex: Int)
}

public enum TerminalPaneTarget: Equatable, Sendable {
  case contextPane(UUID)
  case pane(windowIndex: Int, spaceIndex: Int, projectIndex: Int, tabIndex: Int, paneIndex: Int)
}

public struct TerminalEqualizePanesRequest: Equatable, Sendable {
  public let target: TerminalTabTarget

  public init(target: TerminalTabTarget) {
    self.target = target
  }
}

public struct TerminalTilePanesRequest: Equatable, Sendable {
  public let target: TerminalTabTarget

  public init(target: TerminalTabTarget) {
    self.target = target
  }
}

public struct TerminalMainVerticalPanesRequest: Equatable, Sendable {
  public let target: TerminalTabTarget

  public init(target: TerminalTabTarget) {
    self.target = target
  }
}

public struct TerminalSendTextRequest: Equatable, Sendable {
  public let mode: SupatermSendTextMode
  public let target: TerminalPaneTarget
  public let text: String

  public init(
    mode: SupatermSendTextMode = .type,
    target: TerminalPaneTarget,
    text: String
  ) {
    self.mode = mode
    self.target = target
    self.text = text
  }
}

public struct TerminalSendKeyRequest: Equatable, Sendable {
  public let key: SupatermInputKey
  public let target: TerminalPaneTarget

  public init(
    key: SupatermInputKey,
    target: TerminalPaneTarget
  ) {
    self.key = key
    self.target = target
  }
}

public struct TerminalCapturePaneRequest: Equatable, Sendable {
  public let lines: Int?
  public let scope: SupatermCapturePaneScope
  public let target: TerminalPaneTarget

  public init(
    lines: Int?,
    scope: SupatermCapturePaneScope,
    target: TerminalPaneTarget
  ) {
    self.lines = lines
    self.scope = scope
    self.target = target
  }
}

public struct TerminalPaneHealthRequest: Equatable, Sendable {
  public let target: TerminalPaneTarget

  public init(target: TerminalPaneTarget) {
    self.target = target
  }
}

public struct TerminalResizePaneRequest: Equatable, Sendable {
  public let amount: UInt16
  public let direction: SupatermResizePaneDirection
  public let target: TerminalPaneTarget

  public init(
    amount: UInt16,
    direction: SupatermResizePaneDirection,
    target: TerminalPaneTarget
  ) {
    self.amount = amount
    self.direction = direction
    self.target = target
  }
}

public struct TerminalSetPaneSizeRequest: Equatable, Sendable {
  public let amount: Double
  public let axis: SupatermPaneAxis
  public let target: TerminalPaneTarget
  public let unit: SupatermPaneSizeUnit

  public init(
    amount: Double,
    axis: SupatermPaneAxis,
    target: TerminalPaneTarget,
    unit: SupatermPaneSizeUnit
  ) {
    self.amount = amount
    self.axis = axis
    self.target = target
    self.unit = unit
  }
}

public struct TerminalRenameTabRequest: Equatable, Sendable {
  public let target: TerminalTabTarget
  public let title: String?

  public init(
    target: TerminalTabTarget,
    title: String?
  ) {
    self.target = target
    self.title = title
  }
}

public struct TerminalRenameSpaceRequest: Equatable, Sendable {
  public let name: String
  public let target: TerminalSpaceTarget

  public init(
    name: String,
    target: TerminalSpaceTarget
  ) {
    self.name = name
    self.target = target
  }
}

public struct TerminalSpaceNavigationRequest: Equatable, Sendable {
  public let contextPaneID: UUID?
  public let windowIndex: Int?

  public init(
    contextPaneID: UUID?,
    windowIndex: Int?
  ) {
    self.contextPaneID = contextPaneID
    self.windowIndex = windowIndex
  }
}

public struct TerminalTabNavigationRequest: Equatable, Sendable {
  public let contextPaneID: UUID?
  public let spaceIndex: Int?
  public let windowIndex: Int?

  public init(
    contextPaneID: UUID?,
    spaceIndex: Int?,
    windowIndex: Int?
  ) {
    self.contextPaneID = contextPaneID
    self.spaceIndex = spaceIndex
    self.windowIndex = windowIndex
  }
}

public struct TerminalCreateSpaceRequest: Equatable, Sendable {
  public let name: String
  public let target: TerminalSpaceNavigationRequest

  public init(
    name: String,
    target: TerminalSpaceNavigationRequest
  ) {
    self.name = name
    self.target = target
  }
}

public struct TerminalAgentHookResult: Equatable, Sendable {
  public let desktopNotification: DesktopNotificationRequest?

  public init(desktopNotification: DesktopNotificationRequest?) {
    self.desktopNotification = desktopNotification
  }
}

public enum TerminalCreatePaneError: Error, Equatable {
  case contextPaneNotFound
  case creationFailed
  case paneNotFound(windowIndex: Int, spaceIndex: Int, tabIndex: Int, paneIndex: Int)
  case spaceNotFound(windowIndex: Int, spaceIndex: Int)
  case tabNotFound(windowIndex: Int, spaceIndex: Int, tabIndex: Int)
  case windowNotFound(Int)
}

public enum TerminalCreateTabError: Error, Equatable {
  case contextPaneNotFound
  case creationFailed
  case projectDirectoryUnavailable(URL)
  case spaceNotFound(windowIndex: Int, spaceIndex: Int)
  case windowNotFound(Int)
}

public enum TerminalControlError: Error, Equatable {
  case captureFailed
  case contextPaneNotFound
  case invalidProjectDirectory
  case invalidSpaceName
  case lastPaneNotFound
  case lastSpaceNotFound
  case lastTabNotFound
  case onlyRemainingSpace
  case paneNotFound(windowIndex: Int, spaceIndex: Int, tabIndex: Int, paneIndex: Int)
  case projectAlreadyExists
  case projectDirectoryUnavailable
  case projectNotFound(windowIndex: Int, spaceIndex: Int, projectIndex: Int)
  case resizeFailed
  case spaceNameUnavailable
  case spaceNotFound(windowIndex: Int, spaceIndex: Int)
  case tabNotFound(windowIndex: Int, spaceIndex: Int, tabIndex: Int)
  case windowNotFound(Int)
}
