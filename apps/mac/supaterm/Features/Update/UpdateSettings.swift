import Foundation
import SupatermCLIShared

public typealias UpdateChannel = SupatermCLIShared.UpdateChannel

public extension UpdateChannel {
  var title: String {
    switch self {
    case .stable:
      "Stable"
    case .tip:
      "Tip"
    }
  }

  var sparkleChannels: Set<String> {
    switch self {
    case .stable:
      []
    case .tip:
      ["tip"]
    }
  }

  var updateCheckInterval: TimeInterval {
    switch self {
    case .stable:
      86400
    case .tip:
      3600
    }
  }
}
