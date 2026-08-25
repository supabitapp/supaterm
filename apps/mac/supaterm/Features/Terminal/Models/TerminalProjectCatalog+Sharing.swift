import Foundation
import Sharing

extension SharedKey where Self == FileStorageKey<TerminalProjectCatalog>.Default {
  static var terminalProjectCatalog: Self {
    Self[
      .fileStorage(
        TerminalProjectCatalog.defaultURL(),
        decoder: JSONDecoder(),
        encoder: TerminalProjectCatalog.fileStorageEncoder()
      ),
      default: .default,
    ]
  }
}
