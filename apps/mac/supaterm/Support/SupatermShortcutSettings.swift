import Foundation

public enum SupatermShortcutID: Codable, Hashable, Sendable, CodingKeyRepresentable {
  case copyAgentSessionID
  case forkAgentSession
  case jumpToLatestUnread
  case newTabInProject
  case nextSpace
  case openPullRequest
  case previousSpace
  case selectSpace(Int)
  case toggleAgentPanel
  case toggleSidebar

  public var codingKey: any CodingKey {
    StringCodingKey(stableKey)
  }

  public init?<Key: CodingKey>(codingKey: Key) {
    self.init(stableKey: codingKey.stringValue)
  }

  public var displayName: String {
    switch self {
    case .copyAgentSessionID:
      "Copy Agent Session ID"
    case .forkAgentSession:
      "Fork Agent Session"
    case .jumpToLatestUnread:
      "Jump to Latest Unread"
    case .newTabInProject:
      "New Tab in Project"
    case .nextSpace:
      "Next Space"
    case .openPullRequest:
      "Open Pull Request"
    case .previousSpace:
      "Previous Space"
    case .selectSpace(let index):
      "Select Space \(index)"
    case .toggleAgentPanel:
      "Toggle Agent Panel"
    case .toggleSidebar:
      "Toggle Sidebar"
    }
  }

  private var stableKey: String {
    switch self {
    case .copyAgentSessionID:
      "copy_agent_session_id"
    case .forkAgentSession:
      "fork_agent_session"
    case .jumpToLatestUnread:
      "jump_to_latest_unread"
    case .newTabInProject:
      "new_tab_in_project"
    case .nextSpace:
      "next_space"
    case .openPullRequest:
      "open_pull_request"
    case .previousSpace:
      "previous_space"
    case .selectSpace(let index):
      "select_space_\(index)"
    case .toggleAgentPanel:
      "toggle_agent_panel"
    case .toggleSidebar:
      "toggle_sidebar"
    }
  }

  private init?(stableKey: String) {
    if stableKey.hasPrefix("select_space_"),
      let index = Int(stableKey.dropFirst("select_space_".count)),
      (1...10).contains(index)
    {
      self = .selectSpace(index)
      return
    }

    switch stableKey {
    case "copy_agent_session_id":
      self = .copyAgentSessionID
    case "fork_agent_session":
      self = .forkAgentSession
    case "jump_to_latest_unread":
      self = .jumpToLatestUnread
    case "new_tab_in_project":
      self = .newTabInProject
    case "next_space":
      self = .nextSpace
    case "open_pull_request":
      self = .openPullRequest
    case "previous_space":
      self = .previousSpace
    case "toggle_agent_panel":
      self = .toggleAgentPanel
    case "toggle_sidebar":
      self = .toggleSidebar
    default:
      return nil
    }
  }

  private struct StringCodingKey: CodingKey {
    let stringValue: String
    let intValue: Int? = nil

    init(_ stringValue: String) {
      self.stringValue = stringValue
    }

    init?(stringValue: String) {
      self.init(stringValue)
    }

    init?(intValue: Int) {
      return nil
    }
  }
}

public struct SupatermShortcutOverride: Codable, Equatable, Hashable, Sendable {
  public struct Modifiers: OptionSet, Codable, Equatable, Hashable, Sendable {
    public let rawValue: Int

    public static let command = Self(rawValue: 1 << 0)
    public static let option = Self(rawValue: 1 << 1)
    public static let control = Self(rawValue: 1 << 2)
    public static let shift = Self(rawValue: 1 << 3)

    public init(rawValue: Int) {
      self.rawValue = rawValue
    }
  }

  public var keyCode: UInt16
  public var modifiers: Modifiers
  public var isEnabled: Bool

  public init(
    keyCode: UInt16,
    modifiers: Modifiers,
    isEnabled: Bool = true
  ) {
    self.keyCode = keyCode
    self.modifiers = modifiers
    self.isEnabled = isEnabled
  }

  public static let disabled = Self(keyCode: 0, modifiers: [], isEnabled: false)

  enum CodingKeys: String, CodingKey {
    case isEnabled = "enabled"
    case keyCode = "key_code"
    case modifiers
  }
}
