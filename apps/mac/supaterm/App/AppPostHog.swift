import Foundation
import PostHog
import Sharing
import SupatermSupport

nonisolated enum AppPostHog {
  private static let appLifecycleDebounceInterval: TimeInterval = 15 * 60

  enum AppLifecycleEvent: String, Sendable {
    case activatedDebounced = "app_activated_debounced"
    case deactivatedDebounced = "app_deactivated_debounced"
  }

  struct AppLifecycleEventDebouncer: Equatable, Sendable {
    var lastActivatedAt: Date?
    var lastDeactivatedAt: Date?

    mutating func shouldCapture(event: AppLifecycleEvent, now: Date) -> Bool {
      switch event {
      case .activatedDebounced:
        return Self.shouldCapture(lastCapturedAt: &lastActivatedAt, now: now)
      case .deactivatedDebounced:
        return Self.shouldCapture(lastCapturedAt: &lastDeactivatedAt, now: now)
      }
    }

    private static func canCapture(lastCapturedAt: Date?, now: Date) -> Bool {
      guard let lastCapturedAt else { return true }
      return now.timeIntervalSince(lastCapturedAt) >= AppPostHog.appLifecycleDebounceInterval
    }

    private static func shouldCapture(lastCapturedAt: inout Date?, now: Date) -> Bool {
      guard canCapture(lastCapturedAt: lastCapturedAt, now: now) else { return false }
      lastCapturedAt = now
      return true
    }
  }

  struct Configuration: Equatable {
    let projectToken: String
    let host: String
    let personProfiles: PostHogPersonProfiles

    init?(infoDictionary: [String: Any]) {
      guard
        let projectToken = Self.string(infoDictionary["PostHogProjectToken"]),
        let host = Self.string(infoDictionary["PostHogHost"]),
        let personProfiles = Self.personProfiles(infoDictionary["PostHogPersonProfiles"])
      else {
        return nil
      }

      self.projectToken = projectToken
      self.host = host
      self.personProfiles = personProfiles
    }

    private static func personProfiles(_ value: Any?) -> PostHogPersonProfiles? {
      guard let value = string(value) else { return nil }

      switch value.lowercased() {
      case "always":
        return .always
      case "identified_only":
        return .identifiedOnly
      case "never":
        return .never
      default:
        return nil
      }
    }

    private static func string(_ value: Any?) -> String? {
      guard let value = value as? String else { return nil }
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? nil : trimmed
    }
  }

  #if !DEBUG
    private static let state = AppPostHogState()
  #endif

  @MainActor
  static func setup(
    supatermSettings: SupatermSettings,
    infoDictionary: [String: Any]
  ) {
    #if DEBUG
      return
    #else
      guard isSetupEnabled(supatermSettings: supatermSettings, isDebugBuild: false) else {
        state.setErrorReportingEnabled(false)
        return
      }
      guard let configuration = Configuration(infoDictionary: infoDictionary) else {
        state.setErrorReportingEnabled(false)
        return
      }

      let distinctID = supatermSettings.analyticsEnabled ? HardwareInfo.uuid() : nil
      let config = makeConfig(
        configuration: configuration,
        supatermSettings: supatermSettings,
        distinctID: distinctID
      )
      PostHogSDK.shared.setup(config)
      state.setErrorReportingEnabled(supatermSettings.crashReportsEnabled)
      if supatermSettings.analyticsEnabled {
        PostHogSDK.shared.capture("app_launched")
      }
    #endif
  }

  @MainActor
  static func setup() {
    @Shared(.supatermSettings) var supatermSettings = .default
    setup(
      supatermSettings: supatermSettings,
      infoDictionary: Bundle.main.infoDictionary ?? [:]
    )
  }

  @MainActor
  static func capture(_ event: String) {
    #if DEBUG
      return
    #else
      @Shared(.supatermSettings) var supatermSettings = .default
      guard isAnalyticsEnabled(supatermSettings: supatermSettings, isDebugBuild: false) else { return }
      PostHogSDK.shared.capture(event)
    #endif
  }

  @MainActor
  static func capture(_ event: String, properties: [String: String]) {
    #if DEBUG
      return
    #else
      @Shared(.supatermSettings) var supatermSettings = .default
      guard isAnalyticsEnabled(supatermSettings: supatermSettings, isDebugBuild: false) else { return }
      PostHogSDK.shared.capture(event, properties: properties)
    #endif
  }

  @MainActor
  static func captureDebouncedLifecycleEvent(_ event: AppLifecycleEvent, now: Date = Date()) {
    #if DEBUG
      return
    #else
      @Shared(.supatermSettings) var supatermSettings = .default
      guard isAnalyticsEnabled(supatermSettings: supatermSettings, isDebugBuild: false) else { return }
      guard state.shouldCaptureLifecycleEvent(event, now: now) else { return }
      PostHogSDK.shared.capture(event.rawValue)
    #endif
  }

  nonisolated static func captureException(
    _ error: Error,
    properties: [String: Any]
  ) {
    #if DEBUG
      return
    #else
      guard state.isErrorReportingEnabled else { return }
      PostHogSDK.shared.captureException(error, properties: properties)
    #endif
  }

  static func makeConfig(
    configuration: Configuration,
    supatermSettings: SupatermSettings,
    distinctID: String?
  ) -> PostHogConfig {
    let config = PostHogConfig(
      projectToken: configuration.projectToken,
      host: configuration.host
    )
    config.captureApplicationLifecycleEvents = supatermSettings.analyticsEnabled
    config.captureScreenViews = false
    config.enableSwizzling = false
    config.errorTrackingConfig.autoCapture = supatermSettings.crashReportsEnabled
    config.personProfiles = configuration.personProfiles
    if let distinctID {
      config.bootstrap = PostHogBootstrapConfig(distinctId: distinctID, isIdentifiedId: true)
    }
    config.setBeforeSend { event in
      shouldSend(eventName: event.event) ? event : nil
    }
    return config
  }

  static func shouldSend(eventName: String) -> Bool {
    switch eventName {
    case "Application Opened", "Application Backgrounded":
      return false
    default:
      return true
    }
  }

  static func isSetupEnabled(
    supatermSettings: SupatermSettings,
    isDebugBuild: Bool
  ) -> Bool {
    (supatermSettings.analyticsEnabled || supatermSettings.crashReportsEnabled) && !isDebugBuild
  }

  static func isAnalyticsEnabled(
    supatermSettings: SupatermSettings,
    isDebugBuild: Bool
  ) -> Bool {
    supatermSettings.analyticsEnabled && !isDebugBuild
  }

  static func isErrorReportingEnabled(
    supatermSettings: SupatermSettings,
    isDebugBuild: Bool
  ) -> Bool {
    supatermSettings.crashReportsEnabled && !isDebugBuild
  }
}

#if !DEBUG
  nonisolated private final class AppPostHogState: @unchecked Sendable {
    private let lock = NSLock()
    private var appLifecycleEventDebouncer = AppPostHog.AppLifecycleEventDebouncer()
    private var errorReportingEnabled = false

    var isErrorReportingEnabled: Bool {
      lock.lock()
      let value = errorReportingEnabled
      lock.unlock()
      return value
    }

    func setErrorReportingEnabled(_ isEnabled: Bool) {
      lock.lock()
      errorReportingEnabled = isEnabled
      lock.unlock()
    }

    func shouldCaptureLifecycleEvent(
      _ event: AppPostHog.AppLifecycleEvent,
      now: Date
    ) -> Bool {
      lock.lock()
      defer { lock.unlock() }
      return appLifecycleEventDebouncer.shouldCapture(event: event, now: now)
    }
  }
#endif
