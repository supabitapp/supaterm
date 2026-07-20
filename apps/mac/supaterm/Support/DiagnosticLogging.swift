import ComposableArchitecture
import Foundation
import OSLog

public nonisolated enum SupatermLog {
  public static let subsystem = "app.supabit.supaterm"
  public static let sidebarDrag = Logger(subsystem: subsystem, category: "sidebar-drag")
  public static let terminal = Logger(subsystem: subsystem, category: "terminal")
  public static let zmx = Logger(subsystem: subsystem, category: "zmx")

  private static let verboseLoggingEnabled = LockIsolated(false)
  private static let verboseLoggingEnvironmentKey = "SUPATERM_VERBOSE_LOGGING"

  public static var isVerboseLoggingForced: Bool {
    isVerboseLoggingForced(environment: ProcessInfo.processInfo.environment)
  }

  private static var isVerboseLoggingEnabled: Bool {
    verboseLoggingEnabled.value || isVerboseLoggingForced
  }

  static func isVerboseLoggingForced(environment: [String: String]) -> Bool {
    environment[verboseLoggingEnvironmentKey] == "1"
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

  public static func verbose(
    _ logger: Logger,
    _ event: String,
    fields: [String] = []
  ) {
    guard isVerboseLoggingEnabled else { return }
    notice(logger, event, fields: fields)
  }

  public static func notice(
    _ logger: Logger,
    _ event: String,
    fields: [String] = []
  ) {
    let fields = fields.joined(separator: " ")
    if fields.isEmpty {
      logger.notice("\(event, privacy: .public)")
    } else {
      logger.notice("\(event, privacy: .public) \(fields, privacy: .public)")
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
