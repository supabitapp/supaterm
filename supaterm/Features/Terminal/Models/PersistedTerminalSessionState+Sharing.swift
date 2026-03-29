import Foundation
import Sharing

extension SharedKey where Self == FileStorageKey<PersistedTerminalSessionCatalog>.Default {
  static var terminalSessionCatalog: Self {
    Self[
      .fileStorage(
        PersistedTerminalSessionCatalog.defaultURL(),
        decoder: JSONDecoder(),
        encoder: PersistedTerminalSessionCatalog.fileStorageEncoder()
      ),
      default: .default
    ]
  }
}
