import Combine
import Foundation

@MainActor
final class GhosttySurfaceSearchState: ObservableObject {
  @Published var needle: String
  @Published var selected: UInt?
  @Published var total: UInt?

  init(needle: String = "") {
    self.needle = needle
  }
}

extension Notification.Name {
  static let ghosttySearchFocus = Notification.Name("app.supabit.supaterm.ghosttySearchFocus")
}
