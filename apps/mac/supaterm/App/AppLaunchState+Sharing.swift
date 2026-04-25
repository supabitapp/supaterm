import Foundation
import Sharing
import SupatermCLIShared

extension SharedKey where Self == FileStorageKey<Date?>.Default {
  static var lastAppLaunchedDate: Self {
    Self[
      .fileStorage(
        SupatermStateRoot.fileURL("launch-state.json"),
        decoder: JSONDecoder(),
        encoder: JSONEncoder()
      ),
      default: nil
    ]
  }
}
