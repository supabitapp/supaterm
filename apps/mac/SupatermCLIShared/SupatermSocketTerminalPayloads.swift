import Foundation

public enum SupatermPaneDirection: String, CaseIterable, Sendable, Codable {
  case down
  case left
  case right
  case up
}

public struct SupatermNewTabRequest: Equatable, Sendable, Codable {
  public let startupCommand: String?
  public let contextPaneID: UUID?
  public let cwd: String?
  public let focus: Bool
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?

  public init(
    startupCommand: String? = nil,
    contextPaneID: UUID? = nil,
    cwd: String? = nil,
    focus: Bool,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil
  ) {
    self.startupCommand = startupCommand
    self.contextPaneID = contextPaneID
    self.cwd = cwd
    self.focus = focus
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
  }
}

public struct SupatermNewTabResult: Equatable, Sendable, Codable {
  public let isFocused: Bool
  public let isSelectedSpace: Bool
  public let isSelectedTab: Bool
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let paneIndex: Int
  public let paneID: UUID

  public init(
    isFocused: Bool,
    isSelectedSpace: Bool,
    isSelectedTab: Bool,
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    tabIndex: Int,
    tabID: UUID,
    paneIndex: Int,
    paneID: UUID
  ) {
    self.isFocused = isFocused
    self.isSelectedSpace = isSelectedSpace
    self.isSelectedTab = isSelectedTab
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.paneIndex = paneIndex
    self.paneID = paneID
  }
}

public struct SupatermNewPaneRequest: Equatable, Sendable, Codable {
  public let startupCommand: String?
  public let contextPaneID: UUID?
  public let cwd: String?
  public let direction: SupatermPaneDirection
  public let focus: Bool
  public let equalize: Bool
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?
  public let targetTabIndex: Int?
  public let targetPaneIndex: Int?

  public init(
    startupCommand: String? = nil,
    contextPaneID: UUID? = nil,
    cwd: String? = nil,
    direction: SupatermPaneDirection,
    focus: Bool,
    equalize: Bool,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil,
    targetTabIndex: Int? = nil,
    targetPaneIndex: Int? = nil
  ) {
    self.startupCommand = startupCommand
    self.contextPaneID = contextPaneID
    self.cwd = cwd
    self.direction = direction
    self.focus = focus
    self.equalize = equalize
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
    self.targetTabIndex = targetTabIndex
    self.targetPaneIndex = targetPaneIndex
  }
}

public struct SupatermSpaceTargetRequest: Equatable, Sendable, Codable {
  public let contextPaneID: UUID?
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?

  public init(
    contextPaneID: UUID? = nil,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil
  ) {
    self.contextPaneID = contextPaneID
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
  }
}

public struct SupatermTabTargetRequest: Equatable, Sendable, Codable {
  public let contextPaneID: UUID?
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?
  public let targetTabIndex: Int?

  public init(
    contextPaneID: UUID? = nil,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil,
    targetTabIndex: Int? = nil
  ) {
    self.contextPaneID = contextPaneID
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
    self.targetTabIndex = targetTabIndex
  }
}

public struct SupatermPaneTargetRequest: Equatable, Sendable, Codable {
  public let contextPaneID: UUID?
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?
  public let targetTabIndex: Int?
  public let targetPaneIndex: Int?

  public init(
    contextPaneID: UUID? = nil,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil,
    targetTabIndex: Int? = nil,
    targetPaneIndex: Int? = nil
  ) {
    self.contextPaneID = contextPaneID
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
    self.targetTabIndex = targetTabIndex
    self.targetPaneIndex = targetPaneIndex
  }
}

public enum SupatermSendTextMode: String, Equatable, Sendable, Codable {
  case submit
  case type
}

public struct SupatermSendTextRequest: Equatable, Sendable, Codable {
  public let mode: SupatermSendTextMode
  public let target: SupatermPaneTargetRequest
  public let text: String

  public init(
    mode: SupatermSendTextMode = .type,
    target: SupatermPaneTargetRequest,
    text: String
  ) {
    self.mode = mode
    self.target = target
    self.text = text
  }
}

public enum SupatermInputKey: String, Equatable, Sendable, Codable {
  case backspace
  case ctrlC = "ctrl_c"
  case ctrlD = "ctrl_d"
  case ctrlL = "ctrl_l"
  case ctrlZ = "ctrl_z"
  case enter
  case escape
  case tab
}

public struct SupatermSendKeyRequest: Equatable, Sendable, Codable {
  public let key: SupatermInputKey
  public let target: SupatermPaneTargetRequest

  public init(
    key: SupatermInputKey,
    target: SupatermPaneTargetRequest
  ) {
    self.key = key
    self.target = target
  }
}

public enum SupatermCapturePaneScope: String, Equatable, Sendable, Codable {
  case scrollback
  case visible
}

public struct SupatermCapturePaneRequest: Equatable, Sendable, Codable {
  public let lines: Int?
  public let scope: SupatermCapturePaneScope
  public let target: SupatermPaneTargetRequest

  public init(
    lines: Int? = nil,
    scope: SupatermCapturePaneScope = .visible,
    target: SupatermPaneTargetRequest
  ) {
    self.lines = lines
    self.scope = scope
    self.target = target
  }
}

public struct SupatermPaneHealthRequest: Equatable, Sendable, Codable {
  public let target: SupatermPaneTargetRequest

  public init(target: SupatermPaneTargetRequest) {
    self.target = target
  }
}

public enum SupatermResizePaneDirection: String, Equatable, Sendable, Codable {
  case down
  case left
  case right
  case up
}

public enum SupatermPaneAxis: String, Equatable, Sendable, Codable {
  case horizontal
  case vertical
}

public enum SupatermPaneSizeUnit: String, Equatable, Sendable, Codable {
  case cells
  case percent
}

public struct SupatermResizePaneRequest: Equatable, Sendable, Codable {
  public let amount: UInt16
  public let direction: SupatermResizePaneDirection
  public let target: SupatermPaneTargetRequest

  public init(
    amount: UInt16,
    direction: SupatermResizePaneDirection,
    target: SupatermPaneTargetRequest
  ) {
    self.amount = amount
    self.direction = direction
    self.target = target
  }
}

public struct SupatermSetPaneSizeRequest: Equatable, Sendable, Codable {
  public let amount: Double
  public let axis: SupatermPaneAxis
  public let target: SupatermPaneTargetRequest
  public let unit: SupatermPaneSizeUnit

  public init(
    amount: Double,
    axis: SupatermPaneAxis,
    target: SupatermPaneTargetRequest,
    unit: SupatermPaneSizeUnit
  ) {
    self.amount = amount
    self.axis = axis
    self.target = target
    self.unit = unit
  }
}

public struct SupatermRenameTabRequest: Equatable, Sendable, Codable {
  public let target: SupatermTabTargetRequest
  public let title: String?

  public init(
    target: SupatermTabTargetRequest,
    title: String?
  ) {
    self.target = target
    self.title = title?.trimmingCharacters(in: .whitespacesAndNewlines)
  }
}

public struct SupatermCreateSpaceRequest: Equatable, Sendable, Codable {
  public let name: String
  public let target: SupatermSpaceNavigationRequest

  public init(
    name: String,
    target: SupatermSpaceNavigationRequest = .init()
  ) {
    self.name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    self.target = target
  }
}

public struct SupatermRenameSpaceRequest: Equatable, Sendable, Codable {
  public let target: SupatermSpaceTargetRequest
  public let name: String

  public init(
    target: SupatermSpaceTargetRequest,
    name: String
  ) {
    self.target = target
    self.name = name
  }
}

public struct SupatermSpaceNavigationRequest: Equatable, Sendable, Codable {
  public let contextPaneID: UUID?
  public let targetWindowIndex: Int?

  public init(
    contextPaneID: UUID? = nil,
    targetWindowIndex: Int? = nil
  ) {
    self.contextPaneID = contextPaneID
    self.targetWindowIndex = targetWindowIndex
  }
}

public struct SupatermTabNavigationRequest: Equatable, Sendable, Codable {
  public let contextPaneID: UUID?
  public let targetWindowIndex: Int?
  public let targetSpaceIndex: Int?

  public init(
    contextPaneID: UUID? = nil,
    targetWindowIndex: Int? = nil,
    targetSpaceIndex: Int? = nil
  ) {
    self.contextPaneID = contextPaneID
    self.targetWindowIndex = targetWindowIndex
    self.targetSpaceIndex = targetSpaceIndex
  }
}

public struct SupatermSpaceTarget: Equatable, Sendable, Codable {
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID
  public let name: String

  public init(
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    name: String
  ) {
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.name = name
  }
}

public struct SupatermTabTarget: Equatable, Sendable, Codable {
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let title: String

  public init(
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    tabIndex: Int,
    tabID: UUID,
    title: String
  ) {
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.title = title
  }
}

public struct SupatermPaneTarget: Equatable, Sendable, Codable {
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let paneIndex: Int
  public let paneID: UUID

  public init(
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    tabIndex: Int,
    tabID: UUID,
    paneIndex: Int,
    paneID: UUID
  ) {
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.paneIndex = paneIndex
    self.paneID = paneID
  }
}

public struct SupatermFocusPaneResult: Equatable, Sendable, Codable {
  public let isFocused: Bool
  public let isSelectedTab: Bool
  public let target: SupatermPaneTarget

  public init(
    isFocused: Bool,
    isSelectedTab: Bool,
    target: SupatermPaneTarget
  ) {
    self.isFocused = isFocused
    self.isSelectedTab = isSelectedTab
    self.target = target
  }
}

public struct SupatermSelectTabResult: Equatable, Sendable, Codable {
  public let isFocused: Bool
  public let isSelectedSpace: Bool
  public let isSelectedTab: Bool
  public let isTitleLocked: Bool
  public let paneIndex: Int
  public let paneID: UUID
  public let target: SupatermTabTarget

  public init(
    isFocused: Bool,
    isSelectedSpace: Bool,
    isSelectedTab: Bool,
    isTitleLocked: Bool,
    paneIndex: Int,
    paneID: UUID,
    target: SupatermTabTarget
  ) {
    self.isFocused = isFocused
    self.isSelectedSpace = isSelectedSpace
    self.isSelectedTab = isSelectedTab
    self.isTitleLocked = isTitleLocked
    self.paneIndex = paneIndex
    self.paneID = paneID
    self.target = target
  }
}

public struct SupatermSelectSpaceResult: Equatable, Sendable, Codable {
  public let isFocused: Bool
  public let isSelectedSpace: Bool
  public let isSelectedTab: Bool
  public let paneIndex: Int
  public let paneID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let target: SupatermSpaceTarget

  public init(
    isFocused: Bool,
    isSelectedSpace: Bool,
    isSelectedTab: Bool,
    paneIndex: Int,
    paneID: UUID,
    tabIndex: Int,
    tabID: UUID,
    target: SupatermSpaceTarget
  ) {
    self.isFocused = isFocused
    self.isSelectedSpace = isSelectedSpace
    self.isSelectedTab = isSelectedTab
    self.paneIndex = paneIndex
    self.paneID = paneID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.target = target
  }
}

public struct SupatermCapturePaneResult: Equatable, Sendable, Codable {
  public let target: SupatermPaneTarget
  public let text: String

  public init(
    target: SupatermPaneTarget,
    text: String
  ) {
    self.target = target
    self.text = text
  }
}

public struct SupatermPaneHealthResult: Equatable, Sendable, Codable {
  public let target: SupatermPaneTarget
  public let isReady: Bool
  public let hasSurface: Bool
  public let hasBridgeSurface: Bool
  public let isAttachedToWindow: Bool
  public let isWindowVisible: Bool
  public let canCaptureText: Bool

  public init(
    target: SupatermPaneTarget,
    isReady: Bool,
    hasSurface: Bool,
    hasBridgeSurface: Bool,
    isAttachedToWindow: Bool,
    isWindowVisible: Bool,
    canCaptureText: Bool
  ) {
    self.target = target
    self.isReady = isReady
    self.hasSurface = hasSurface
    self.hasBridgeSurface = hasBridgeSurface
    self.isAttachedToWindow = isAttachedToWindow
    self.isWindowVisible = isWindowVisible
    self.canCaptureText = canCaptureText
  }
}

public struct SupatermRenameTabResult: Equatable, Sendable, Codable {
  public let isTitleLocked: Bool
  public let target: SupatermTabTarget

  public init(
    isTitleLocked: Bool,
    target: SupatermTabTarget
  ) {
    self.isTitleLocked = isTitleLocked
    self.target = target
  }
}

public struct SupatermPinTabResult: Equatable, Sendable, Codable {
  public let isPinned: Bool
  public let target: SupatermTabTarget

  public init(
    isPinned: Bool,
    target: SupatermTabTarget
  ) {
    self.isPinned = isPinned
    self.target = target
  }
}

public typealias SupatermClosePaneResult = SupatermPaneTarget
public typealias SupatermCloseSpaceResult = SupatermSpaceTarget
public typealias SupatermCloseTabResult = SupatermTabTarget
public typealias SupatermCreateSpaceResult = SupatermSelectSpaceResult
public typealias SupatermEqualizePanesResult = SupatermTabTarget
public typealias SupatermMainVerticalPanesResult = SupatermTabTarget
public typealias SupatermResizePaneResult = SupatermPaneTarget
public typealias SupatermSetPaneSizeResult = SupatermPaneTarget
public typealias SupatermSendKeyResult = SupatermPaneTarget
public typealias SupatermSendTextResult = SupatermPaneTarget
public typealias SupatermTilePanesResult = SupatermTabTarget

public struct SupatermNewPaneResult: Equatable, Sendable, Codable {
  public let direction: SupatermPaneDirection
  public let isFocused: Bool
  public let isSelectedTab: Bool
  public let windowIndex: Int
  public let spaceIndex: Int
  public let spaceID: UUID
  public let tabIndex: Int
  public let tabID: UUID
  public let paneIndex: Int
  public let paneID: UUID

  public init(
    direction: SupatermPaneDirection,
    isFocused: Bool,
    isSelectedTab: Bool,
    windowIndex: Int,
    spaceIndex: Int,
    spaceID: UUID,
    tabIndex: Int,
    tabID: UUID,
    paneIndex: Int,
    paneID: UUID
  ) {
    self.direction = direction
    self.isFocused = isFocused
    self.isSelectedTab = isSelectedTab
    self.windowIndex = windowIndex
    self.spaceIndex = spaceIndex
    self.spaceID = spaceID
    self.tabIndex = tabIndex
    self.tabID = tabID
    self.paneIndex = paneIndex
    self.paneID = paneID
  }
}
