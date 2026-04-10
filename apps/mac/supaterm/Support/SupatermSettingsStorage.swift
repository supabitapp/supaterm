import Foundation
import Sharing
import SupatermCLIShared

public typealias SupatermSettings = SupatermCLIShared.SupatermSettings

public extension SharedKey where Self == FileStorageKey<SupatermSettings>.Default {
  static var supatermSettings: Self {
    Self[
      .fileStorage(
        SupatermSettings.defaultURL(),
        decoder: JSONDecoder(),
        encoder: supatermSettingsFileStorageEncoder()
      ),
      default: .default
    ]
  }
}

private func supatermSettingsFileStorageEncoder() -> JSONEncoder {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  return encoder
}
