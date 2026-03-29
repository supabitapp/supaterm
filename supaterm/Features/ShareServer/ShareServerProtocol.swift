import Foundation
import SupatermCLIShared

nonisolated enum ShareServerError: Error, Equatable, LocalizedError {
  case invalidMessage
  case missingField(String)
  case invalidField(String)
  case unsupportedMessage(String)

  var errorDescription: String? {
    switch self {
    case .invalidMessage:
      return "Invalid control message."
    case .missingField(let field):
      return "Missing field '\(field)'."
    case .invalidField(let field):
      return "Invalid field '\(field)'."
    case .unsupportedMessage(let type):
      return "Unsupported control message '\(type)'."
    }
  }
}

nonisolated struct ShareWorkspaceState: Equatable, Sendable, Codable {
  var workspaces: [WorkspaceItem]
  var selectedWorkspaceId: String?
  var tabs: [Tab]
  var selectedTabId: String?
  var trees: [String: SplitTree]
  var focusedPaneByTab: [String: String]
  var panes: [String: Pane]

  nonisolated struct WorkspaceItem: Equatable, Sendable, Codable {
    var id: String
    var name: String
  }

  nonisolated struct Tab: Equatable, Sendable, Codable {
    var id: String
    var workspaceId: String
    var title: String
    var icon: String?
    var isDirty: Bool
    var isPinned: Bool
    var isTitleLocked: Bool
    var tone: String
  }

  nonisolated struct Pane: Equatable, Sendable, Codable {
    var id: String
    var tabId: String
    var sessionName: String
    var title: String
    var pwd: String?
    var isRunning: Bool
    var cols: Int
    var rows: Int
  }

  nonisolated struct SplitTree: Equatable, Sendable, Codable {
    var root: Node?
    var zoomed: Node?
  }

  nonisolated indirect enum Node: Equatable, Sendable, Codable {
    case leaf(id: String)
    case split(direction: String, ratio: Double, left: Node, right: Node)

    private enum CodingKeys: String, CodingKey {
      case type
      case id
      case direction
      case ratio
      case left
      case right
    }

    init(from decoder: Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      switch try container.decode(String.self, forKey: .type) {
      case "leaf":
        self = .leaf(id: try container.decode(String.self, forKey: .id))
      case "split":
        self = .split(
          direction: try container.decode(String.self, forKey: .direction),
          ratio: try container.decode(Double.self, forKey: .ratio),
          left: try container.decode(Node.self, forKey: .left),
          right: try container.decode(Node.self, forKey: .right)
        )
      default:
        throw DecodingError.dataCorruptedError(
          forKey: .type,
          in: container,
          debugDescription: "Unsupported split tree node type."
        )
      }
    }

    func encode(to encoder: Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      switch self {
      case .leaf(let id):
        try container.encode("leaf", forKey: .type)
        try container.encode(id, forKey: .id)
      case .split(let direction, let ratio, let left, let right):
        try container.encode("split", forKey: .type)
        try container.encode(direction, forKey: .direction)
        try container.encode(ratio, forKey: .ratio)
        try container.encode(left, forKey: .left)
        try container.encode(right, forKey: .right)
      }
    }
  }
}

nonisolated struct ShareSyncMessage: Equatable, Sendable, Codable {
  var state: ShareWorkspaceState

  enum CodingKeys: String, CodingKey {
    case type
    case state
  }

  init(state: ShareWorkspaceState) {
    self.state = state
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    _ = try container.decode(String.self, forKey: .type)
    state = try container.decode(ShareWorkspaceState.self, forKey: .state)
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode("sync", forKey: .type)
    try container.encode(state, forKey: .state)
  }
}

nonisolated struct ShareErrorMessage: Equatable, Sendable, Codable {
  var code: String
  var message: String

  enum CodingKeys: String, CodingKey {
    case type
    case code
    case message
  }

  init(code: String, message: String) {
    self.code = code
    self.message = message
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    _ = try container.decode(String.self, forKey: .type)
    code = try container.decode(String.self, forKey: .code)
    message = try container.decode(String.self, forKey: .message)
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode("error", forKey: .type)
    try container.encode(code, forKey: .code)
    try container.encode(message, forKey: .message)
  }
}

nonisolated struct SharePaneRuntime: Equatable, Sendable {
  var paneId: UUID
  var sessionName: String
  var cols: Int
  var rows: Int
}

nonisolated enum ShareClientMessage: Equatable, Sendable {
  case sync
  case createTab(inheritFromPaneId: UUID?)
  case closeTab(tabId: UUID)
  case selectTab(tabId: UUID)
  case selectTabSlot(slot: Int)
  case nextTab
  case previousTab
  case createPane(tabId: UUID, direction: SupatermPaneDirection, targetPaneId: UUID?, command: String?, focus: Bool)
  case closePane(paneId: UUID)
  case resizePane(paneId: UUID, cols: Int, rows: Int)
  case focusPane(paneId: UUID)
  case splitResize(paneId: UUID, delta: Double, axis: String)
  case equalizePanes(tabId: UUID)
  case toggleZoom(tabId: UUID)
  case createWorkspace
  case deleteWorkspace(workspaceId: UUID)
  case renameWorkspace(workspaceId: UUID, name: String)
  case selectWorkspace(workspaceId: UUID)
  case setTabOrder(tabIds: [UUID], pinned: Bool)
  case togglePinned(tabId: UUID)
  case resume

  init(data: Data) throws {
    let value = try JSONDecoder().decode(JSONValue.self, from: data)
    guard case .object(let object) = value else {
      throw ShareServerError.invalidMessage
    }
    guard case .string(let type)? = object["type"] else {
      throw ShareServerError.missingField("type")
    }

    func uuid(_ key: String) throws -> UUID {
      guard let value = object[key]?.stringValue else {
        throw ShareServerError.missingField(key)
      }
      guard let uuid = UUID(uuidString: value) else {
        throw ShareServerError.invalidField(key)
      }
      return uuid
    }

    func optionalUUID(_ key: String) throws -> UUID? {
      guard let value = object[key] else { return nil }
      if case .null = value { return nil }
      guard let string = value.stringValue else {
        throw ShareServerError.invalidField(key)
      }
      guard let uuid = UUID(uuidString: string) else {
        throw ShareServerError.invalidField(key)
      }
      return uuid
    }

    func int(_ key: String) throws -> Int {
      guard let value = object[key]?.intValue else {
        throw ShareServerError.invalidField(key)
      }
      return value
    }

    func bool(_ key: String, default defaultValue: Bool) throws -> Bool {
      guard let value = object[key] else { return defaultValue }
      guard let bool = value.boolValue else {
        throw ShareServerError.invalidField(key)
      }
      return bool
    }

    func string(_ key: String) throws -> String {
      guard let value = object[key]?.stringValue else {
        throw ShareServerError.invalidField(key)
      }
      return value
    }

    func optionalString(_ key: String) -> String? {
      object[key]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    switch type {
    case "sync":
      self = .sync
    case "create_tab":
      self = .createTab(inheritFromPaneId: try optionalUUID("inheritFromPaneId"))
    case "close_tab":
      self = .closeTab(tabId: try uuid("tabId"))
    case "select_tab":
      self = .selectTab(tabId: try uuid("tabId"))
    case "select_tab_slot":
      self = .selectTabSlot(slot: try int("slot"))
    case "next_tab":
      self = .nextTab
    case "previous_tab":
      self = .previousTab
    case "create_pane":
      guard let rawDirection = object["direction"]?.stringValue,
        let direction = SupatermPaneDirection(rawValue: rawDirection)
      else {
        throw ShareServerError.invalidField("direction")
      }
      self = .createPane(
        tabId: try uuid("tabId"),
        direction: direction,
        targetPaneId: try optionalUUID("targetPaneId"),
        command: optionalString("command"),
        focus: try bool("focus", default: true)
      )
    case "close_pane":
      self = .closePane(paneId: try uuid("paneId"))
    case "resize_pane":
      self = .resizePane(paneId: try uuid("paneId"), cols: try int("cols"), rows: try int("rows"))
    case "focus_pane":
      self = .focusPane(paneId: try uuid("paneId"))
    case "split_resize":
      guard let delta = object["delta"]?.doubleValue else {
        throw ShareServerError.invalidField("delta")
      }
      self = .splitResize(paneId: try uuid("paneId"), delta: delta, axis: try string("axis"))
    case "equalize_panes":
      self = .equalizePanes(tabId: try uuid("tabId"))
    case "toggle_zoom":
      self = .toggleZoom(tabId: try uuid("tabId"))
    case "create_workspace":
      self = .createWorkspace
    case "delete_workspace":
      self = .deleteWorkspace(workspaceId: try uuid("workspaceId"))
    case "rename_workspace":
      self = .renameWorkspace(workspaceId: try uuid("workspaceId"), name: try string("name"))
    case "select_workspace":
      self = .selectWorkspace(workspaceId: try uuid("workspaceId"))
    case "set_tab_order":
      guard let values = object["tabIds"]?.arrayValue else {
        throw ShareServerError.invalidField("tabIds")
      }
      let ids = try values.map { value -> UUID in
        guard let string = value.stringValue, let uuid = UUID(uuidString: string) else {
          throw ShareServerError.invalidField("tabIds")
        }
        return uuid
      }
      self = .setTabOrder(tabIds: ids, pinned: try bool("pinned", default: false))
    case "toggle_pinned":
      self = .togglePinned(tabId: try uuid("tabId"))
    case "resume":
      self = .resume
    default:
      throw ShareServerError.unsupportedMessage(type)
    }
  }
}
