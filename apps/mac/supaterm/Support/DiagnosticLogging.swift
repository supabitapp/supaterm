import ComposableArchitecture
import Foundation
import OSLog

public nonisolated enum SupatermLog {
  public static let subsystem = "app.supabit.supaterm"
  public static let terminal = Logger(subsystem: subsystem, category: "terminal")
  public static let zmx = Logger(subsystem: subsystem, category: "zmx")

  private static let verboseLoggingEnabled = LockIsolated(false)

  private static var isVerboseLoggingEnabled: Bool {
    verboseLoggingEnabled.value
  }

  public static func setVerboseLoggingEnabled(_ isEnabled: Bool) {
    verboseLoggingEnabled.withValue {
      $0 = isEnabled
    }
  }

  public static func debug(
    _ logger: Logger,
    _ event: String,
    fields: [String] = []
  ) {
    guard isVerboseLoggingEnabled else { return }
    let fields = fields.joined(separator: " ")
    if fields.isEmpty {
      logger.debug("\(event, privacy: .public)")
    } else {
      logger.debug("\(event, privacy: .public) \(fields, privacy: .public)")
    }
  }

  public static func error(
    _ logger: Logger,
    _ event: String,
    fields: [String] = []
  ) {
    let fields = fields.joined(separator: " ")
    if fields.isEmpty {
      logger.error("\(event, privacy: .public)")
    } else {
      logger.error("\(event, privacy: .public) \(fields, privacy: .public)")
    }
  }

  public static func uuid(_ value: UUID?) -> String {
    value?.uuidString.lowercased() ?? "nil"
  }
}
