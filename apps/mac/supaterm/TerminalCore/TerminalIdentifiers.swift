import Foundation
import SupatermCLIShared

public nonisolated struct PaneID: SupatermUUIDIdentifier {
  public let rawValue: UUID

  public init(rawValue: UUID) {
    self.rawValue = rawValue
  }
}
