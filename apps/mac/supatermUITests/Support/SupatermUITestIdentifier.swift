enum SupatermUITestIdentifier {
  enum Accessibility {
    static let sidebarSpaceButton = "sidebar.space-button"
    static let sidebarCreateSpaceButton = "sidebar.create-space-button"
    static let sidebarTabRow = "sidebar.tab-row"
    static let sidebarPinnedSection = "sidebar.pinned-section"
    static let sidebarRegularSection = "sidebar.regular-section"
    static let paletteInput = "palette.input"
    static let paletteResultRow = "palette.result-row"
    static let dialogConfirm = "dialog.confirm"
    static let dialogCancel = "dialog.cancel"
    static let dialogSpaceName = "dialog.space-name"
    static let dialogQuit = "dialog.quit"
    static let searchField = "terminal.search.field"
    static let searchMatchCount = "terminal.search.match-count"
    static let clipboardConfirm = "terminal.clipboard-confirmation.confirm"
    static let clipboardCancel = "terminal.clipboard-confirmation.cancel"
  }

  enum Settings {
    static let window = "app.supabit.supaterm.window.settings"
    static let restoreTerminalLayout = "settings.general.restore-terminal-layout"
    static let appearanceAuto = "settings.general.appearance.system"
    static let appearanceLight = "settings.general.appearance.light"
    static let appearanceDark = "settings.general.appearance.dark"
    static let terminalFont = "settings.terminal.font"
    static let notificationsSystem = "settings.notifications.system"
    static let codingAgentsShowPanel = "settings.coding-agents.show-panel"
    static let advancedVerboseLogging = "settings.advanced.verbose-logging"
    static let aboutVersion = "settings.about.version"
    static let checkForUpdates = "settings.about.check-for-updates"
    static let updateChannel = "settings.about.update-channel"
    static let automaticallyCheckForUpdates = "settings.about.automatically-check-for-updates"

    static func sidebar(_ tab: String) -> String {
      "settings.sidebar.\(tab)"
    }
  }

  enum MenuItemIdentifier: String {
    case about = "app.supabit.supaterm.app.about"
    case checkForUpdates = "app.supabit.supaterm.app.checkForUpdates"
    case settings = "app.supabit.supaterm.app.settings"
    case newWindow = "app.supabit.supaterm.file.newWindow"
    case newTab = "app.supabit.supaterm.file.newTab"
    case splitRight = "app.supabit.supaterm.file.splitRight"
    case splitDown = "app.supabit.supaterm.file.splitDown"
    case closeSurface = "app.supabit.supaterm.file.close"
    case closeTab = "app.supabit.supaterm.file.closeTab"
    case closeWindow = "app.supabit.supaterm.file.closeWindow"
    case closeAllWindows = "app.supabit.supaterm.file.closeAllWindows"
    case openCommandPalette = "app.supabit.supaterm.file.openCommandPalette"
    case copy = "app.supabit.supaterm.edit.copy"
    case paste = "app.supabit.supaterm.edit.paste"
    case pasteSelection = "app.supabit.supaterm.edit.pasteSelection"
    case findNext = "app.supabit.supaterm.edit.findNext"
    case findPrevious = "app.supabit.supaterm.edit.findPrevious"
    case toggleSidebar = "app.supabit.supaterm.view.toggleSidebar"
    case toggleAgentPanel = "app.supabit.supaterm.view.toggleAgentPanel"
    case changeTabTitle = "app.supabit.supaterm.view.changeTabTitle"
    case changeTerminalTitle = "app.supabit.supaterm.view.changeTerminalTitle"
    case nextTab = "app.supabit.supaterm.tabs.next"
    case previousTab = "app.supabit.supaterm.tabs.previous"
    case selectLastTab = "app.supabit.supaterm.tabs.last"
    case firstSpace = "app.supabit.supaterm.spaces.select.1"
    case secondSpace = "app.supabit.supaterm.spaces.select.2"
    case zoomSplit = "app.supabit.supaterm.window.zoomSplit"
    case nextSplit = "app.supabit.supaterm.window.nextSplit"
    case selectSplitLeft = "app.supabit.supaterm.window.selectSplitLeft"
    case selectSplitRight = "app.supabit.supaterm.window.selectSplitRight"
    case equalizeSplits = "app.supabit.supaterm.window.equalizeSplits"
    case moveSplitDividerLeft = "app.supabit.supaterm.window.moveSplitDividerLeft"
    case submitGitHubIssue = "app.supabit.supaterm.help.submitGitHubIssue"
    case changelog = "app.supabit.supaterm.help.changelog"

    var menuTitle: String {
      switch rawValue.split(separator: ".")[3] {
      case "app": "Supaterm"
      case "file": "File"
      case "edit": "Edit"
      case "view": "View"
      case "tabs": "Tabs"
      case "spaces": "Spaces"
      case "window": "Window"
      case "help": "Help"
      default: preconditionFailure("Unknown menu item identifier: \(rawValue)")
      }
    }
  }
}
