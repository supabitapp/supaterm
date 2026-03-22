import Foundation
import Sharing

extension SharedKey where Self == FileStorageKey<TerminalSpaceCatalog>.Default {
  static var terminalSpaceCatalog: Self {
    Self[
      .fileStorage(
        TerminalSpaceCatalog.defaultURL(),
        decoder: JSONDecoder(),
        encoder: TerminalSpaceCatalog.fileStorageEncoder()
      ),
      default: .default
    ]
  }
}
