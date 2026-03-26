import Foundation
import Sharing

nonisolated struct AppPrefs: Codable, Equatable, Sendable {
  var appearanceMode: AppearanceMode

  static let `default` = Self(appearanceMode: .system)

  static func defaultURL(homeDirectoryPath: String = NSHomeDirectory()) -> URL {
    URL(fileURLWithPath: homeDirectoryPath, isDirectory: true)
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
      .appendingPathComponent("appprefs.json", isDirectory: false)
  }

  static func fileStorageEncoder() -> JSONEncoder {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    return encoder
  }
}

extension SharedKey where Self == FileStorageKey<AppPrefs>.Default {
  static var appPrefs: Self {
    Self[
      .fileStorage(
        AppPrefs.defaultURL(),
        decoder: JSONDecoder(),
        encoder: AppPrefs.fileStorageEncoder()
      ),
      default: .default
    ]
  }
}
