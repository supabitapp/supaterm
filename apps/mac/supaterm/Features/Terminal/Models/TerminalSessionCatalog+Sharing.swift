import Foundation
import Sharing

extension SharedKey where Self == FileStorageKey<TerminalSessionCatalog>.Default {
  static var terminalSessionCatalog: Self {
    Self[
      .fileStorage(
        TerminalSessionCatalog.defaultURL(),
        decoder: JSONDecoder(),
        encoder: TerminalSessionCatalog.fileStorageEncoder()
      ),
      default: .default
    ]
  }
}
