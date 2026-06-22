import GhosttyKit

public struct GhosttyCommand: Equatable, Sendable {
  public let title: String
  public let description: String
  public let action: String
  public let actionKey: String

  public var isSupported: Bool {
    !Self.unsupportedActionKeys.contains(actionKey)
  }

  static let unsupportedActionKeys: [String] = [
    "check_for_updates",
    "goto_window",
    "reset_window_size",
    "toggle_fullscreen",
    "toggle_maximize",
    "toggle_quick_terminal",
    "toggle_tab_overview",
    "toggle_window_float_on_top",
    "toggle_window_decorations",
    "show_gtk_inspector",
  ]

  public init(
    title: String,
    description: String,
    action: String,
    actionKey: String
  ) {
    self.title = title
    self.description = description
    self.action = action
    self.actionKey = actionKey
  }

  init(cValue: ghostty_command_s) {
    self.init(
      title: String(cString: cValue.title),
      description: String(cString: cValue.description),
      action: String(cString: cValue.action),
      actionKey: String(cString: cValue.action_key)
    )
  }
}
