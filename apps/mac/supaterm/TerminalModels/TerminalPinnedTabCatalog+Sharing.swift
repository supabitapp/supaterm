import Foundation
import Sharing

extension SharedKey where Self == FileStorageKey<TerminalPinnedTabCatalog>.Default {
  public static var terminalPinnedTabCatalog: Self {
    Self[
      .fileStorage(
        TerminalPinnedTabCatalog.defaultURL(),
        decoder: JSONDecoder(),
        encoder: TerminalPinnedTabCatalog.fileStorageEncoder()
      ),
      default: .default
    ]
  }
}
