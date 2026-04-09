import Foundation

public enum NewTabPosition: String, Codable, CaseIterable, Equatable, Hashable, Identifiable, Sendable {
  case current
  case end

  public var id: Self {
    self
  }

  public var title: String {
    switch self {
    case .current:
      "After Current Tab"
    case .end:
      "At End"
    }
  }
}
