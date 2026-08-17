import Foundation
import Sharing

extension SharedKey where Self == FileStorageKey<TerminalSessionCatalog>.Default {
  static var terminalSessionCatalog: Self {
    let url = TerminalSessionCatalog.defaultURL()
    TerminalSessionCatalogMigration.migrateStoredCatalog(at: url)
    return Self[
      .fileStorage(
        url,
        decoder: JSONDecoder(),
        encoder: TerminalSessionCatalog.fileStorageEncoder()
      ),
      default: .default
    ]
  }
}
