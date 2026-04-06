import Foundation

public enum AppearanceMode: String, CaseIterable, Codable, Hashable, Identifiable, Sendable {
  case system
  case light
  case dark

  public var id: String {
    rawValue
  }
}
