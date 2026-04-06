import Foundation
import Sharing
import SupatermCLIShared

typealias AppPrefs = SupatermCLIShared.AppPrefs

extension SharedKey where Self == FileStorageKey<AppPrefs>.Default {
  static var appPrefs: Self {
    Self[
      .fileStorage(
        AppPrefs.defaultURL(),
        decoder: JSONDecoder(),
        encoder: appPrefsFileStorageEncoder()
      ),
      default: .default
    ]
  }
}

private func appPrefsFileStorageEncoder() -> JSONEncoder {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  return encoder
}
