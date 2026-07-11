import Foundation
import GhosttyKit

enum GhosttyConfigDiagnostics {
  static func messages(in config: ghostty_config_t) -> [String] {
    let count = Int(ghostty_config_diagnostics_count(config))
    return (0..<count).compactMap { index in
      let diagnostic = ghostty_config_get_diagnostic(config, UInt32(index))
      guard let message = diagnostic.message else { return nil }
      let trimmed = String(cString: message).trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? nil : trimmed
    }
  }
}
