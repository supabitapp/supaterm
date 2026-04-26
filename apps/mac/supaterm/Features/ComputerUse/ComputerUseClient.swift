import ComposableArchitecture
import Foundation
import SupatermCLIShared

public enum ComputerUseError: Equatable, LocalizedError {
  case accessibilityPermissionMissing
  case elementNotFound(Int)
  case imageWriteFailed(String)
  case invalidClickTarget
  case keyUnsupported(String)
  case screenRecordingPermissionMissing
  case snapshotRequired
  case unsupportedBackgroundTarget
  case windowNotFound(UInt32)

  public var code: String {
    switch self {
    case .accessibilityPermissionMissing:
      return "accessibility_permission_missing"
    case .elementNotFound:
      return "element_not_found"
    case .imageWriteFailed:
      return "image_write_failed"
    case .invalidClickTarget:
      return "invalid_click_target"
    case .keyUnsupported:
      return "key_unsupported"
    case .screenRecordingPermissionMissing:
      return "screen_recording_permission_missing"
    case .snapshotRequired:
      return "snapshot_required"
    case .unsupportedBackgroundTarget:
      return "unsupported_background_target"
    case .windowNotFound:
      return "window_not_found"
    }
  }

  public var errorDescription: String? {
    switch self {
    case .accessibilityPermissionMissing:
      return "Grant Accessibility in Settings > Computer Use."
    case .elementNotFound(let index):
      return "No element with index \(index) exists in the latest snapshot."
    case .imageWriteFailed(let path):
      return "Could not write screenshot to \(path)."
    case .invalidClickTarget:
      return "Provide either --element or both --x and --y."
    case .keyUnsupported(let key):
      return "Unsupported key '\(key)'."
    case .screenRecordingPermissionMissing:
      return "Grant Screen Recording in Settings > Computer Use."
    case .snapshotRequired:
      return "Run `sp computer-use snapshot` for this window before acting on an element."
    case .unsupportedBackgroundTarget:
      return "This target cannot be controlled in the background."
    case .windowNotFound(let windowID):
      return "No window with ID \(windowID) was found."
    }
  }
}

public struct ComputerUseClient: Sendable {
  public var permissions: @MainActor @Sendable () async -> SupatermComputerUsePermissionsResult
  public var apps: @MainActor @Sendable () async throws -> SupatermComputerUseAppsResult
  public var windows:
    @MainActor @Sendable (SupatermComputerUseWindowsRequest) async throws ->
      SupatermComputerUseWindowsResult
  public var snapshot:
    @MainActor @Sendable (SupatermComputerUseSnapshotRequest) async throws ->
      SupatermComputerUseSnapshotResult
  public var click:
    @MainActor @Sendable (SupatermComputerUseClickRequest) async throws ->
      SupatermComputerUseActionResult
  public var type:
    @MainActor @Sendable (SupatermComputerUseTypeRequest) async throws ->
      SupatermComputerUseActionResult
  public var key:
    @MainActor @Sendable (SupatermComputerUseKeyRequest) async throws ->
      SupatermComputerUseActionResult
  public var scroll:
    @MainActor @Sendable (SupatermComputerUseScrollRequest) async throws ->
      SupatermComputerUseActionResult
  public var setValue:
    @MainActor @Sendable (SupatermComputerUseSetValueRequest) async throws ->
      SupatermComputerUseActionResult

  public init(
    permissions: @escaping @MainActor @Sendable () async -> SupatermComputerUsePermissionsResult,
    apps: @escaping @MainActor @Sendable () async throws -> SupatermComputerUseAppsResult,
    windows:
      @escaping @MainActor @Sendable (
        SupatermComputerUseWindowsRequest
      ) async throws -> SupatermComputerUseWindowsResult,
    snapshot:
      @escaping @MainActor @Sendable (
        SupatermComputerUseSnapshotRequest
      ) async throws -> SupatermComputerUseSnapshotResult,
    click:
      @escaping @MainActor @Sendable (
        SupatermComputerUseClickRequest
      ) async throws -> SupatermComputerUseActionResult,
    type:
      @escaping @MainActor @Sendable (
        SupatermComputerUseTypeRequest
      ) async throws -> SupatermComputerUseActionResult,
    key:
      @escaping @MainActor @Sendable (
        SupatermComputerUseKeyRequest
      ) async throws -> SupatermComputerUseActionResult,
    scroll:
      @escaping @MainActor @Sendable (
        SupatermComputerUseScrollRequest
      ) async throws -> SupatermComputerUseActionResult,
    setValue:
      @escaping @MainActor @Sendable (
        SupatermComputerUseSetValueRequest
      ) async throws -> SupatermComputerUseActionResult
  ) {
    self.permissions = permissions
    self.apps = apps
    self.windows = windows
    self.snapshot = snapshot
    self.click = click
    self.type = type
    self.key = key
    self.scroll = scroll
    self.setValue = setValue
  }
}

extension ComputerUseClient: DependencyKey {
  public static let liveValue = Self.live(runtime: .shared)

  public static let testValue = Self(
    permissions: {
      .init(accessibility: .missing, screenRecording: .missing)
    },
    apps: {
      .init(apps: [])
    },
    windows: { _ in
      .init(windows: [])
    },
    snapshot: { request in
      .init(pid: request.pid, windowID: request.windowID, frame: nil, elements: [], screenshot: nil)
    },
    click: { _ in
      .init(ok: true, dispatch: "test")
    },
    type: { _ in
      .init(ok: true, dispatch: "test")
    },
    key: { _ in
      .init(ok: true, dispatch: "test")
    },
    scroll: { _ in
      .init(ok: true, dispatch: "test")
    },
    setValue: { _ in
      .init(ok: true, dispatch: "test")
    }
  )

  public static func live(runtime: ComputerUseRuntime) -> Self {
    Self(
      permissions: {
        await runtime.permissions()
      },
      apps: {
        runtime.apps()
      },
      windows: { request in
        runtime.windows(request)
      },
      snapshot: { request in
        try await runtime.snapshot(request)
      },
      click: { request in
        try runtime.click(request)
      },
      type: { request in
        try runtime.type(request)
      },
      key: { request in
        try runtime.key(request)
      },
      scroll: { request in
        try runtime.scroll(request)
      },
      setValue: { request in
        try runtime.setValue(request)
      }
    )
  }
}

extension DependencyValues {
  public var computerUseClient: ComputerUseClient {
    get { self[ComputerUseClient.self] }
    set { self[ComputerUseClient.self] = newValue }
  }
}
