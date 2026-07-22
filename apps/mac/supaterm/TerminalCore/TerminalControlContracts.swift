import Foundation
import SupatermCLIShared
import SupatermSupport

public struct TerminalCreateTabRequest: Equatable, Sendable {
  public enum Target: Equatable, Sendable {
    case group(UUID)
    case pane(UUID)
    case root(UUID)
    case space(UUID)
  }

  public let startupCommand: String?
  public let cwd: String?
  public let focus: Bool
  public let target: Target

  public init(
    startupCommand: String?,
    cwd: String?,
    focus: Bool,
    target: Target
  ) {
    self.startupCommand = startupCommand
    self.cwd = cwd
    self.focus = focus
    self.target = target
  }
}

public struct TerminalCreatePaneRequest: Equatable, Sendable {
  public enum Target: Equatable, Sendable {
    case pane(UUID)
    case tab(UUID)
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

  public init(spaceID: UUID) {
    self.spaceID = spaceID
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

public struct TerminalCreateTabGroupRequest: Equatable, Sendable {
  public let color: SupatermTabGroupColor
  public let isPinned: Bool
  public let target: TerminalSpaceTarget
  public let title: String

  public init(
    color: SupatermTabGroupColor,
    isPinned: Bool,
    target: TerminalSpaceTarget,
    title: String
  ) {
    self.color = color
    self.isPinned = isPinned
    self.target = target
    self.title = title
  }
}

public struct TerminalRenameTabGroupRequest: Equatable, Sendable {
  public let groupID: UUID
  public let title: String

  public init(
    groupID: UUID,
    title: String
  ) {
    self.groupID = groupID
    self.title = title
  }
}

public struct TerminalSetTabGroupColorRequest: Equatable, Sendable {
  public let color: SupatermTabGroupColor
  public let groupID: UUID

  public init(
    color: SupatermTabGroupColor,
    groupID: UUID
  ) {
    self.color = color
    self.groupID = groupID
  }
}

public struct TerminalSetTabGroupCollapsedRequest: Equatable, Sendable {
  public let groupID: UUID
  public let isCollapsed: Bool

  public init(
    groupID: UUID,
    isCollapsed: Bool
  ) {
    self.groupID = groupID
    self.isCollapsed = isCollapsed
  }
}

public struct TerminalMoveTabGroupRequest: Equatable, Sendable {
  public let groupID: UUID
  public let index: Int

  public init(
    groupID: UUID,
    index: Int
  ) {
    self.groupID = groupID
    self.index = index
  }
}

public enum TerminalMoveTabDestination: Equatable, Sendable {
  case group(id: UUID, index: Int?)
  case root(isPinned: Bool, index: Int?)
}

public struct TerminalMoveTabRequest: Equatable, Sendable {
  public let destination: TerminalMoveTabDestination
  public let target: TerminalTabTarget

  public init(
    destination: TerminalMoveTabDestination,
    target: TerminalTabTarget
  ) {
    self.destination = destination
    self.target = target
  }
}

public enum TerminalTabGroupRequest: Equatable, Sendable {
  case close(UUID)
  case create(TerminalCreateTabGroupRequest)
  case move(TerminalMoveTabGroupRequest)
  case moveTab(TerminalMoveTabRequest)
  case pin(UUID)
  case rename(TerminalRenameTabGroupRequest)
  case setCollapsed(TerminalSetTabGroupCollapsedRequest)
  case setColor(TerminalSetTabGroupColorRequest)
  case ungroup(UUID)
  case unpin(UUID)
}

public enum TerminalTabGroupResult: Equatable, Sendable {
  case group(SupatermTabGroupMutationResult)
  case movedTab(SupatermMoveTabResult)
  case removedGroup(SupatermRemoveTabGroupResult)
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
  public let spaceID: UUID

  public init(spaceID: UUID) {
    self.spaceID = spaceID
  }
}

public struct TerminalTabNavigationRequest: Equatable, Sendable {
  public let spaceID: UUID

  public init(spaceID: UUID) {
    self.spaceID = spaceID
  }
}

public struct TerminalCreateSpaceRequest: Equatable, Sendable {
  public let focus: Bool
  public let name: String
  public let windowAnchorPaneID: UUID

  public init(
    focus: Bool,
    name: String,
    windowAnchorPaneID: UUID
  ) {
    self.focus = focus
    self.name = name
    self.windowAnchorPaneID = windowAnchorPaneID
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
  case spaceNotFound(windowIndex: Int, spaceIndex: Int)
  case windowNotFound(Int)
}

public enum TerminalControlError: Error, Equatable {
  case captureFailed
  case contextPaneNotFound
  case groupNotFound(UUID)
  case groupSpaceMismatch
  case invalidGroupTitle
  case invalidGroupIndex(Int)
  case invalidSpaceName
  case lastPaneNotFound
  case lastSpaceNotFound
  case lastTabNotFound
  case onlyRemainingSpace
  case paneNotFound(windowIndex: Int, spaceIndex: Int, tabIndex: Int, paneIndex: Int)
  case resizeFailed
  case spaceNameUnavailable
  case spaceNotFound(windowIndex: Int, spaceIndex: Int)
  case tabNotFound(windowIndex: Int, spaceIndex: Int, tabIndex: Int)
  case windowNotFound(Int)
}
