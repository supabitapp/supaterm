import Foundation

public enum UpdateChannel: String, Codable, CaseIterable, Equatable, Hashable, Identifiable, Sendable {
  case stable
  case tip

  public var id: Self {
    self
  }
}
