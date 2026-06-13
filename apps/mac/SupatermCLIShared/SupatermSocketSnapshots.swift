import Foundation

public struct SupatermDebugRequest: Equatable, Sendable, Codable {
  public let context: SupatermCLIContext?

  public init(context: SupatermCLIContext? = nil) {
    self.context = context
  }
}

public struct SupatermAppDebugSnapshot: Equatable, Sendable, Codable {
  public struct Build: Equatable, Sendable, Codable {
    public let version: String
    public let buildNumber: String
    public let isDevelopmentBuild: Bool
    public let usesStubUpdateChecks: Bool

    public init(
      version: String,
      buildNumber: String,
      isDevelopmentBuild: Bool,
      usesStubUpdateChecks: Bool
    ) {
      self.version = version
      self.buildNumber = buildNumber
      self.isDevelopmentBuild = isDevelopmentBuild
      self.usesStubUpdateChecks = usesStubUpdateChecks
    }
  }

  public struct Update: Equatable, Sendable, Codable {
    public let canCheckForUpdates: Bool
    public let phase: String
    public let detail: String

    public init(
      canCheckForUpdates: Bool,
      phase: String,
      detail: String
    ) {
      self.canCheckForUpdates = canCheckForUpdates
      self.phase = phase
      self.detail = detail
    }
  }

  public struct Summary: Equatable, Sendable, Codable {
    public let windowCount: Int
    public let spaceCount: Int
    public let tabCount: Int
    public let paneCount: Int
    public let keyWindowIndex: Int?

    public init(
      windowCount: Int,
      spaceCount: Int,
      tabCount: Int,
      paneCount: Int,
      keyWindowIndex: Int?
    ) {
      self.windowCount = windowCount
      self.spaceCount = spaceCount
      self.tabCount = tabCount
      self.paneCount = paneCount
      self.keyWindowIndex = keyWindowIndex
    }
  }

  public struct CurrentTarget: Equatable, Sendable, Codable {
    public let windowIndex: Int
    public let spaceIndex: Int
    public let spaceID: UUID
    public let spaceName: String
    public let tabIndex: Int
    public let tabID: UUID
    public let tabTitle: String
    public let paneIndex: Int?
    public let paneID: UUID?

    public init(
      windowIndex: Int,
      spaceIndex: Int,
      spaceID: UUID,
      spaceName: String,
      tabIndex: Int,
      tabID: UUID,
      tabTitle: String,
      paneIndex: Int?,
      paneID: UUID?
    ) {
      self.windowIndex = windowIndex
      self.spaceIndex = spaceIndex
      self.spaceID = spaceID
      self.spaceName = spaceName
      self.tabIndex = tabIndex
      self.tabID = tabID
      self.tabTitle = tabTitle
      self.paneIndex = paneIndex
      self.paneID = paneID
    }
  }

  public struct Window: Equatable, Sendable, Codable {
    public let index: Int
    public let isKey: Bool
    public let isVisible: Bool
    public let spaces: [Space]

    public init(
      index: Int,
      isKey: Bool,
      isVisible: Bool,
      spaces: [Space]
    ) {
      self.index = index
      self.isKey = isKey
      self.isVisible = isVisible
      self.spaces = spaces
    }
  }

  public struct Space: Equatable, Sendable, Codable {
    public let index: Int
    public let id: UUID
    public let name: String
    public let isSelected: Bool
    public let tabs: [Tab]

    public init(
      index: Int,
      id: UUID,
      name: String,
      isSelected: Bool,
      tabs: [Tab]
    ) {
      self.index = index
      self.id = id
      self.name = name
      self.isSelected = isSelected
      self.tabs = tabs
    }
  }

  public struct Tab: Equatable, Sendable, Codable {
    public let index: Int
    public let id: UUID
    public let title: String
    public let isSelected: Bool
    public let isPinned: Bool
    public let isDirty: Bool
    public let isTitleLocked: Bool
    public let hasRunningActivity: Bool
    public let hasBell: Bool
    public let hasReadOnly: Bool
    public let hasSecureInput: Bool
    public let panes: [Pane]

    public init(
      index: Int,
      id: UUID,
      title: String,
      isSelected: Bool,
      isPinned: Bool,
      isDirty: Bool,
      isTitleLocked: Bool,
      hasRunningActivity: Bool,
      hasBell: Bool,
      hasReadOnly: Bool,
      hasSecureInput: Bool,
      panes: [Pane]
    ) {
      self.index = index
      self.id = id
      self.title = title
      self.isSelected = isSelected
      self.isPinned = isPinned
      self.isDirty = isDirty
      self.isTitleLocked = isTitleLocked
      self.hasRunningActivity = hasRunningActivity
      self.hasBell = hasBell
      self.hasReadOnly = hasReadOnly
      self.hasSecureInput = hasSecureInput
      self.panes = panes
    }
  }

  public struct Pane: Equatable, Sendable, Codable {
    public let index: Int
    public let id: UUID
    public let isFocused: Bool
    public let displayTitle: String
    public let pwd: String?
    public let isReadOnly: Bool
    public let hasSecureInput: Bool
    public let bellCount: Int
    public let isRunning: Bool
    public let progressState: String?
    public let progressValue: Int?
    public let needsCloseConfirmation: Bool
    public let lastCommandExitCode: Int?
    public let lastCommandDurationMs: UInt64?
    public let lastChildExitCode: UInt32?
    public let lastChildExitTimeMs: UInt64?

    public init(
      index: Int,
      id: UUID,
      isFocused: Bool,
      displayTitle: String,
      pwd: String?,
      isReadOnly: Bool,
      hasSecureInput: Bool,
      bellCount: Int,
      isRunning: Bool,
      progressState: String?,
      progressValue: Int?,
      needsCloseConfirmation: Bool,
      lastCommandExitCode: Int?,
      lastCommandDurationMs: UInt64?,
      lastChildExitCode: UInt32?,
      lastChildExitTimeMs: UInt64?
    ) {
      self.index = index
      self.id = id
      self.isFocused = isFocused
      self.displayTitle = displayTitle
      self.pwd = pwd
      self.isReadOnly = isReadOnly
      self.hasSecureInput = hasSecureInput
      self.bellCount = bellCount
      self.isRunning = isRunning
      self.progressState = progressState
      self.progressValue = progressValue
      self.needsCloseConfirmation = needsCloseConfirmation
      self.lastCommandExitCode = lastCommandExitCode
      self.lastCommandDurationMs = lastCommandDurationMs
      self.lastChildExitCode = lastChildExitCode
      self.lastChildExitTimeMs = lastChildExitTimeMs
    }
  }

  public let build: Build
  public let update: Update
  public let summary: Summary
  public let currentTarget: CurrentTarget?
  public let windows: [Window]
  public let problems: [String]

  public init(
    build: Build,
    update: Update,
    summary: Summary,
    currentTarget: CurrentTarget?,
    windows: [Window],
    problems: [String]
  ) {
    self.build = build
    self.update = update
    self.summary = summary
    self.currentTarget = currentTarget
    self.windows = windows
    self.problems = problems
  }
}

public struct SupatermTreeSnapshot: Equatable, Sendable, Codable {
  public struct Window: Equatable, Sendable, Codable {
    public let index: Int
    public let isKey: Bool
    public let spaces: [Space]

    public init(index: Int, isKey: Bool, spaces: [Space]) {
      self.index = index
      self.isKey = isKey
      self.spaces = spaces
    }
  }

  public struct Space: Equatable, Sendable, Codable {
    public let index: Int
    public let id: UUID
    public let name: String
    public let isSelected: Bool
    public let tabs: [Tab]

    public init(
      index: Int,
      id: UUID,
      name: String,
      isSelected: Bool,
      tabs: [Tab]
    ) {
      self.index = index
      self.id = id
      self.name = name
      self.isSelected = isSelected
      self.tabs = tabs
    }
  }

  public struct Tab: Equatable, Sendable, Codable {
    public let index: Int
    public let id: UUID
    public let title: String
    public let isSelected: Bool
    public let panes: [Pane]

    public init(index: Int, id: UUID, title: String, isSelected: Bool, panes: [Pane]) {
      self.index = index
      self.id = id
      self.title = title
      self.isSelected = isSelected
      self.panes = panes
    }
  }

  public struct Pane: Equatable, Sendable, Codable {
    public let index: Int
    public let id: UUID
    public let isFocused: Bool

    public init(index: Int, id: UUID, isFocused: Bool) {
      self.index = index
      self.id = id
      self.isFocused = isFocused
    }
  }

  public let windows: [Window]

  public init(windows: [Window]) {
    self.windows = windows
  }
}

public struct SupatermOnboardingShortcut: Equatable, Sendable, Codable {
  public let shortcut: String
  public let title: String

  public init(
    shortcut: String,
    title: String
  ) {
    self.shortcut = shortcut
    self.title = title
  }
}

public struct SupatermOnboardingSnapshot: Equatable, Sendable, Codable {
  public let items: [SupatermOnboardingShortcut]

  public init(items: [SupatermOnboardingShortcut]) {
    self.items = items
  }
}
