import AppKit

enum HostClientPreferences {
  private static let appearanceKey = "client.appearance"
  private static let systemNotificationsKey = "client.system-notifications"

  static var appearance: String {
    get { UserDefaults.standard.string(forKey: appearanceKey) ?? "dark" }
    set {
      UserDefaults.standard.set(newValue, forKey: appearanceKey)
      applyAppearance()
    }
  }

  static var systemNotificationsEnabled: Bool {
    get { UserDefaults.standard.bool(forKey: systemNotificationsKey) }
    set { UserDefaults.standard.set(newValue, forKey: systemNotificationsKey) }
  }

  static func applyAppearance() {
    NSApp.appearance =
      switch appearance {
      case "light": NSAppearance(named: .aqua)
      case "system": nil
      default: NSAppearance(named: .darkAqua)
      }
  }
}
