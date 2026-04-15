import Foundation
import Sharing
import SupatermCLIShared

public typealias SupatermSettings = SupatermCLIShared.SupatermSettings

extension SharedKey where Self == FileStorageKey<SupatermSettings>.Default {
  public static var supatermSettings: Self {
    SupatermSettingsMigration.migrateDefaultSettingsIfNeeded()
    return Self[
      .fileStorage(
        SupatermSettings.defaultURL(),
        decode: SupatermSettingsCodec.decode,
        encode: SupatermSettingsCodec.encode
      ),
      default: .default
    ]
  }
}
