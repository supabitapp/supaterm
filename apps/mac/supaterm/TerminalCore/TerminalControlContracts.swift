import Foundation
import SupatermCLIShared
import SupatermSupport

public struct TerminalCreateTabRequest: Equatable, Sendable {
  public enum Target: Equatable, Sendable {
    case pane(UUID)
    case space(UUID)
  }

  public let startupCommand: SupatermTerminalStartup?
  public let cwd: String?
  public let focus: Bool
  public let projectID: UUID?
  public let target: Target
  public let context: SupatermCLIContext?

  public init(
    startupCommand: SupatermTerminalStartup?,
    cwd: String?,
    focus: Bool,
    projectID: UUID?,
    target: Target,
    context: SupatermCLIContext? = nil
  ) {
    self.startupCommand = startupCommand
    self.cwd = cwd
    self.focus = focus
    self.projectID = projectID
    self.target = target
    self.context = context
  }
}

public struct TerminalCreatePaneRequest: Equatable, Sendable {
  public enum Target: Equatable, Sendable {
    case pane(UUID)
    case tab(UUID)
  }

  public let startupCommand: SupatermTerminalStartup?
  public let cwd: String?
  public let direction: SupatermPaneDirection
  public let focus: Bool
  public let equalize: Bool
  public let target: Target

  public init(
    startupCommand: SupatermTerminalStartup?,
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
    case pane(UUID)
    case tab(UUID)
  }

  public let allowDesktopNotificationWhenAgentActive: Bool
  public let body: String
  public let target: Target
  public let title: String?

  public init(
    body: String,
    target: Target,
    title: String?,
    allowDesktopNotificationWhenAgentActive: Bool = false
  ) {
    self.allowDesktopNotificationWhenAgentActive = allowDesktopNotificationWhenAgentActive
    self.body = body
    self.target = target
    self.title = title
  }
}

public struct TerminalSpaceTarget: Equatable, Sendable {
  public let spaceID: UUID
  public let context: SupatermCLIContext?

  public init(spaceID: UUID, context: SupatermCLIContext? = nil) {
    self.spaceID = spaceID
    self.context = context
  }
}

public struct TerminalTabTarget: Equatable, Sendable {
  public let tabID: UUID

  public init(tabID: UUID) {
    self.tabID = tabID
  }
}

public struct TerminalPaneTarget: Equatable, Sendable {
  public let paneID: UUID

  public init(paneID: UUID) {
    self.paneID = paneID
  }
}

public enum TerminalProjectRequest: Equatable, Sendable {
  case add(SupatermAddProjectRequest)
  case moveTab(SupatermMoveTabRequest)
  case pin(SupatermProjectTargetRequest)
  case remove(SupatermRemoveProjectRequest)
  case rename(SupatermRenameProjectRequest)
  case reorder(SupatermReorderProjectRequest)
  case setCollapsed(SupatermSetProjectCollapsedRequest)
  case setColor(SupatermSetProjectColorRequest)
  case unpin(SupatermProjectTargetRequest)
}

public enum TerminalProjectResult: Equatable, Sendable {
  case movedTab(SupatermMoveTabResult)
  case project(SupatermProjectMutationResult)
  case removedProject(SupatermRemoveProjectResult)
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
  public struct LineCount: Equatable, Sendable {
    public let value: UInt32

    public init?(exactly value: Int) {
      guard let value = UInt32(exactly: value), value > 0 else { return nil }
      self.value = value
    }
  }

  public let lines: LineCount?
  public let scope: SupatermCapturePaneScope
  public let target: TerminalPaneTarget

  public init(
    lines: LineCount?,
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
  public let context: SupatermCLIContext?

  public init(context: SupatermCLIContext? = nil) {
    self.context = context
  }
}

public struct TerminalTabNavigationRequest: Equatable, Sendable {
  public let spaceID: UUID
  public let context: SupatermCLIContext?

  public init(spaceID: UUID, context: SupatermCLIContext? = nil) {
    self.spaceID = spaceID
    self.context = context
  }
}

public struct TerminalCreateSpaceRequest: Equatable, Sendable {
  public let color: SupatermThemeColor?
  public let name: String
  public let context: SupatermCLIContext?

  public init(
    color: SupatermThemeColor?,
    name: String,
    context: SupatermCLIContext? = nil
  ) {
    self.color = color
    self.name = name
    self.context = context
  }
}

public struct TerminalSetSpaceColorRequest: Equatable, Sendable {
  public let color: SupatermThemeColor
  public let target: TerminalSpaceTarget

  public init(
    color: SupatermThemeColor,
    target: TerminalSpaceTarget
  ) {
    self.color = color
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
  case tabLimitReached(limit: Int, openTabs: Int)
  case spaceNotFound(windowIndex: Int, spaceIndex: Int)
  case windowNotFound(Int)

  public static func tabLimitMessage(limit: Int) -> String {
    "Free mode allows \(limit) open tabs. Run `sp license activate` to unlock more."
  }
}

public enum TerminalControlError: Error, Equatable {
  case captureFailed
  case contextPaneNotFound
  case invalidCaptureLines(Int)
  case invalidProjectIndex(Int)
  case invalidProjectName
  case invalidSpaceName
  case lastPaneNotFound
  case lastSpaceNotFound
  case lastTabNotFound
  case onlyRemainingSpace
  case paneNotFound(windowIndex: Int, spaceIndex: Int, tabIndex: Int, paneIndex: Int)
  case projectCloseConfirmationRequired
  case projectNotFound(UUID)
  case resizeFailed
  case screenshotFailed
  case spaceNameUnavailable
  case spaceNotFound(windowIndex: Int, spaceIndex: Int)
  case tabNotFound(windowIndex: Int, spaceIndex: Int, tabIndex: Int)
  case windowNotFound(Int)
}
