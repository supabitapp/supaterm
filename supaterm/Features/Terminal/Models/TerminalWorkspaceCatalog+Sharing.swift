import Foundation
import Sharing

extension SharedKey where Self == FileStorageKey<TerminalWorkspaceCatalog>.Default {
  static var terminalWorkspaceCatalog: Self {
    Self[
      .fileStorage(
        TerminalWorkspaceCatalog.defaultURL(),
        decoder: JSONDecoder(),
        encoder: TerminalWorkspaceCatalog.fileStorageEncoder()
      ),
      default: .default
    ]
  }
}
