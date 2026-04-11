import Foundation
import SupatermCLIShared

public typealias UpdateChannel = SupatermCLIShared.UpdateChannel

extension UpdateChannel {
  public var title: String {
    switch self {
    case .stable:
      "Stable"
    case .tip:
      "Tip"
    }
  }

  public var sparkleChannels: Set<String> {
    switch self {
    case .stable:
      []
    case .tip:
      ["tip"]
    }
  }

  public var updateCheckInterval: TimeInterval {
    switch self {
    case .stable:
      86400
    case .tip:
      3600
    }
  }
}
