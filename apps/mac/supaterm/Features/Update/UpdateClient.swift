import AppKit
import ComposableArchitecture
import Foundation
import Sharing
import Sparkle
import SupatermLicenseFeature
import SupatermSupport

public enum UpdateUserAction: Equatable, Sendable {
  case allowAutomaticChecks
  case cancel
  case checkForUpdates
  case declineAutomaticChecks
  case dismiss
  case downloadLatestIncludedRelease
  case install
  case installAfterNextRestart
  case renewUpdates
  case restartLater
  case restartNow
  case retry
  case skipVersion
}

enum UpdatePresentationMode: Equatable, Sendable {
  case sidebar
  case standard
}

enum UpdatePresentation {
  static func mode(
    hasUnobtrusiveTarget: Bool
  ) -> UpdatePresentationMode {
    return hasUnobtrusiveTarget ? .sidebar : .standard
  }
}

public enum UpdatePhase: Equatable, Sendable {
  public struct Available: Equatable, Sendable {
    public var buildVersion: String?
    public var contentLength: UInt64?
    public var releaseDate: Date?
    public var version: String

    public init(
      buildVersion: String? = nil,
      contentLength: UInt64?,
      releaseDate: Date?,
      version: String
    ) {
      self.buildVersion = buildVersion
      self.contentLength = contentLength
      self.releaseDate = releaseDate
      self.version = version
    }

    public var formattedVersion: String? {
      UpdatePhase.formattedVersion(version: version, buildVersion: buildVersion)
    }
  }

  public struct Downloading: Equatable, Sendable {
    public var expectedLength: UInt64?
    public var progress: UInt64

    public init(
      expectedLength: UInt64?,
      progress: UInt64
    ) {
      self.expectedLength = expectedLength
      self.progress = progress
    }
  }

  public struct Extracting: Equatable, Sendable {
    public var progress: Double

    public init(progress: Double) {
      self.progress = progress
    }
  }

  public struct Failure: Equatable, Sendable {
    public var message: String

    public init(message: String) {
      self.message = message
    }
  }

  public struct Installing: Equatable, Sendable {
    public var buildVersion: String?
    public var isAutoUpdate: Bool
    public var showsPrompt: Bool
    public var version: String

    public init(
      buildVersion: String? = nil,
      isAutoUpdate: Bool,
      showsPrompt: Bool? = nil,
      version: String = ""
    ) {
      self.buildVersion = buildVersion
      self.isAutoUpdate = isAutoUpdate
      self.showsPrompt = showsPrompt ?? true
      self.version = version
    }

    public var formattedVersion: String? {
      UpdatePhase.formattedVersion(version: version, buildVersion: buildVersion)
    }
  }

  public struct OwnershipEnded: Equatable, Sendable {
    public let licenseID: String
    public let latestIncludedReleaseURL: URL?
    public let updatesThrough: LicenseDay
    public let version: String

    public init(
      licenseID: String,
      latestIncludedReleaseURL: URL? = nil,
      updatesThrough: LicenseDay,
      version: String
    ) {
      self.licenseID = licenseID
      self.latestIncludedReleaseURL = latestIncludedReleaseURL
      self.updatesThrough = updatesThrough
      self.version = version
    }

    public var renewURL: URL {
      LicensePortalURL.license(licenseID)
    }

    func detailMessage(salesEnabled: Bool) -> String {
      let updateNotice = "Supaterm \(version) is out. Your updates ended \(updatesThrough.rawValue)"
      switch (salesEnabled, latestIncludedReleaseURL != nil) {
      case (true, true):
        return "\(updateNotice). Renew to update, or download the newest release included with your license."
      case (true, false):
        return "\(updateNotice) — renew to update."
      case (false, true):
        return "\(updateNotice). Download the newest release included with your license."
      case (false, false):
        return "\(updateNotice). You can keep using your current version."
      }
    }
  }

  case idle
  case permissionRequest
  case checking
  case updateAvailable(Available)
  case downloading(Downloading)
  case extracting(Extracting)
  case installing(Installing)
  case notFound
  case ownershipEnded(OwnershipEnded)
  case error(Failure)

  public var badgeText: String? {
    switch self {
    case .updateAvailable(let available):
      return available.formattedVersion
    case .downloading(let downloading):
      return Self.progressText(
        progress: Double(downloading.progress),
        total: downloading.expectedLength.map { Double($0) }
      )
    case .extracting(let extracting):
      return Self.percentText(Self.clampedProgress(extracting.progress))
    default:
      return nil
    }
  }

  public var bypassesQuitConfirmation: Bool {
    switch self {
    case .installing:
      return true
    default:
      return false
    }
  }

  public var detailMessage: String {
    detailMessage(salesEnabled: AppBuild.licenseSalesEnabled)
  }

  func detailMessage(salesEnabled: Bool) -> String {
    switch self {
    case .idle:
      return ""
    case .permissionRequest:
      return "Allow Supaterm to automatically check for updates in the background."
    case .checking:
      return "Please wait while Supaterm checks for available updates."
    case .updateAvailable(let available):
      guard let version = available.formattedVersion else {
        return "A Supaterm update is ready to download and install."
      }
      return "Supaterm \(version) is ready to download and install."
    case .downloading:
      return "Supaterm is downloading the selected update."
    case .extracting:
      return "Supaterm is preparing the downloaded update."
    case .installing(let installing):
      if let version = installing.formattedVersion {
        return "Updated to \(version). Restart Supaterm to complete installation."
      }
      if installing.isAutoUpdate {
        return "The update is ready. Restart Supaterm to complete installation."
      }
      return "Supaterm is installing the update and preparing to restart."
    case .notFound:
      return "You're already running the latest version."
    case .ownershipEnded(let ownership):
      return ownership.detailMessage(salesEnabled: salesEnabled)
    case .error(let failure):
      return failure.message
    }
  }

  public var debugIdentifier: String {
    switch self {
    case .idle:
      return "idle"
    case .permissionRequest:
      return "permission_request"
    case .checking:
      return "checking"
    case .updateAvailable:
      return "update_available"
    case .downloading:
      return "downloading"
    case .extracting:
      return "extracting"
    case .installing:
      return "installing"
    case .notFound:
      return "not_found"
    case .ownershipEnded:
      return "ownership_ended"
    case .error:
      return "error"
    }
  }

  public var iconName: String {
    switch self {
    case .idle:
      return "circle"
    case .permissionRequest:
      return "questionmark.circle"
    case .checking:
      return "arrow.triangle.2.circlepath"
    case .updateAvailable:
      return "shippingbox.fill"
    case .downloading:
      return "arrow.down.circle"
    case .extracting:
      return "shippingbox"
    case .installing:
      return "power.circle"
    case .notFound:
      return "checkmark.circle"
    case .ownershipEnded:
      return "lock.fill"
    case .error:
      return "exclamationmark.triangle.fill"
    }
  }

  public var isIdle: Bool {
    if case .idle = self {
      return true
    }
    return false
  }

  public var showsSidebarSection: Bool {
    switch self {
    case .idle:
      return false
    case .installing(let installing):
      return installing.showsPrompt
    default:
      return true
    }
  }

  public var menuItemAction: UpdateUserAction? {
    switch self {
    case .installing:
      return .restartNow
    default:
      return nil
    }
  }

  public var menuItemTitle: String {
    switch self {
    case .installing:
      return "Restart to Update..."
    default:
      return "Check for Updates..."
    }
  }

  public var progressValue: Double? {
    switch self {
    case .downloading(let downloading):
      guard let expectedLength = downloading.expectedLength, expectedLength > 0 else {
        return nil
      }
      return Self.clampedProgress(Double(downloading.progress) / Double(expectedLength))
    case .extracting(let extracting):
      return Self.clampedProgress(extracting.progress)
    default:
      return nil
    }
  }

  public var summaryText: String {
    summaryText(salesEnabled: AppBuild.licenseSalesEnabled)
  }

  func summaryText(salesEnabled: Bool) -> String {
    switch self {
    case .idle:
      return ""
    case .permissionRequest:
      return "Enable Automatic Updates?"
    case .checking:
      return "Checking for Updates…"
    case .updateAvailable:
      return "Update Available"
    case .downloading:
      return "Downloading Update"
    case .extracting:
      return "Preparing Update"
    case .installing(let installing):
      return installing.isAutoUpdate ? "Restart to Complete Update" : "Installing Update"
    case .notFound:
      return "No Updates Available"
    case .ownershipEnded:
      return salesEnabled ? "Renew to Update" : "Update Not Included"
    case .error:
      return "Update Failed"
    }
  }

  private static func clampedProgress(_ value: Double) -> Double {
    min(1, max(0, value))
  }

  private static func formattedVersion(
    version: String,
    buildVersion: String?
  ) -> String? {
    let version = version.trimmingCharacters(in: .whitespacesAndNewlines)
    let buildVersion = buildVersion?.trimmingCharacters(in: .whitespacesAndNewlines)

    if let buildVersion, !buildVersion.isEmpty, buildVersion != version {
      if version.isEmpty {
        return buildVersion
      }
      return "\(version) (\(buildVersion))"
    }

    return version.isEmpty ? nil : version
  }

  private static func percentText(_ value: Double) -> String {
    String(format: "%.0f%%", clampedProgress(value) * 100)
  }

  private static func progressText(
    progress: Double,
    total: Double?
  ) -> String? {
    guard let total, total > 0 else { return nil }
    return percentText(progress / total)
  }
}

public struct UpdateClient: Sendable {
  public struct Snapshot: Equatable, Sendable {
    public var automaticallyChecksForUpdates: Bool
    public var automaticallyDownloadsUpdates: Bool
    public var canCheckForUpdates: Bool
    public var phase: UpdatePhase

    public init(
      automaticallyChecksForUpdates: Bool,
      automaticallyDownloadsUpdates: Bool,
      canCheckForUpdates: Bool,
      phase: UpdatePhase
    ) {
      self.automaticallyChecksForUpdates = automaticallyChecksForUpdates
      self.automaticallyDownloadsUpdates = automaticallyDownloadsUpdates
      self.canCheckForUpdates = canCheckForUpdates
      self.phase = phase
    }
  }

  public var observe: @Sendable () async -> AsyncStream<Snapshot>
  public var newestOwnedReleaseURL: @Sendable (LicenseDay) async -> URL?
  public var perform: @Sendable (UpdateUserAction) async -> Void
  public var setAutomaticallyChecksForUpdates: @Sendable (Bool) async -> Void
  public var setAutomaticallyDownloadsUpdates: @Sendable (Bool) async -> Void
  public var setUpdateChannel: @Sendable (UpdateChannel) async -> Void
  public var start: @Sendable () async -> Void

  public init(
    newestOwnedReleaseURL: @escaping @Sendable (LicenseDay) async -> URL?,
    observe: @escaping @Sendable () async -> AsyncStream<Snapshot>,
    perform: @escaping @Sendable (UpdateUserAction) async -> Void,
    setAutomaticallyChecksForUpdates: @escaping @Sendable (Bool) async -> Void,
    setAutomaticallyDownloadsUpdates: @escaping @Sendable (Bool) async -> Void,
    setUpdateChannel: @escaping @Sendable (UpdateChannel) async -> Void,
    start: @escaping @Sendable () async -> Void
  ) {
    self.newestOwnedReleaseURL = newestOwnedReleaseURL
    self.observe = observe
    self.perform = perform
    self.setAutomaticallyChecksForUpdates = setAutomaticallyChecksForUpdates
    self.setAutomaticallyDownloadsUpdates = setAutomaticallyDownloadsUpdates
    self.setUpdateChannel = setUpdateChannel
    self.start = start
  }

  @MainActor
  public static func live(license: UpdateLicenseClient) -> Self {
    let runtime = UpdateRuntime(license: license)
    return Self(
      newestOwnedReleaseURL: { updatesThrough in
        await runtime.newestOwnedReleaseURL(through: updatesThrough)
      },
      observe: {
        await runtime.observe()
      },
      perform: { action in
        await runtime.perform(action)
      },
      setAutomaticallyChecksForUpdates: { isEnabled in
        await runtime.setAutomaticallyChecksForUpdates(isEnabled)
      },
      setAutomaticallyDownloadsUpdates: { isEnabled in
        await runtime.setAutomaticallyDownloadsUpdates(isEnabled)
      },
      setUpdateChannel: { updateChannel in
        await runtime.setUpdateChannel(updateChannel)
      },
      start: {
        let updateChannel = await MainActor.run {
          @Shared(.supatermSettings) var supatermSettings = .default
          return supatermSettings.updateChannel
        }
        await runtime.start(updateChannel: updateChannel)
      }
    )
  }

  public static let inert = Self(
    newestOwnedReleaseURL: { _ in nil },
    observe: { AsyncStream { $0.finish() } },
    perform: { _ in },
    setAutomaticallyChecksForUpdates: { _ in },
    setAutomaticallyDownloadsUpdates: { _ in },
    setUpdateChannel: { _ in },
    start: {}
  )
}

public struct UpdateLicenseClient: Sendable {
  let access: @MainActor @Sendable () -> LicenseAccess
  let refresh: @MainActor @Sendable () async -> Void
  let refreshesBeforeChecks: Bool

  public init(
    access: @escaping @MainActor @Sendable () -> LicenseAccess,
    refresh: @escaping @MainActor @Sendable () async -> Void
  ) {
    self.init(access: access, refresh: refresh, refreshesBeforeChecks: true)
  }

  private init(
    access: @escaping @MainActor @Sendable () -> LicenseAccess,
    refresh: @escaping @MainActor @Sendable () async -> Void,
    refreshesBeforeChecks: Bool
  ) {
    self.access = access
    self.refresh = refresh
    self.refreshesBeforeChecks = refreshesBeforeChecks
  }

  static let unlicensed = Self(
    access: { .free },
    refresh: {},
    refreshesBeforeChecks: false
  )
}

extension UpdateClient: DependencyKey {
  public static var liveValue: Self {
    preconditionFailure("UpdateClient must be injected")
  }

  public static let testValue = Self(
    newestOwnedReleaseURL: unimplemented(
      "UpdateClient.newestOwnedReleaseURL",
      placeholder: nil
    ),
    observe: unimplemented(
      "UpdateClient.observe",
      placeholder: AsyncStream { $0.finish() }
    ),
    perform: unimplemented("UpdateClient.perform"),
    setAutomaticallyChecksForUpdates: unimplemented("UpdateClient.setAutomaticallyChecksForUpdates"),
    setAutomaticallyDownloadsUpdates: unimplemented(
      "UpdateClient.setAutomaticallyDownloadsUpdates"
    ),
    setUpdateChannel: unimplemented("UpdateClient.setUpdateChannel"),
    start: unimplemented("UpdateClient.start")
  )
}

extension DependencyValues {
  public var updateClient: UpdateClient {
    get { self[UpdateClient.self] }
    set { self[UpdateClient.self] = newValue }
  }
}
