import ComposableArchitecture
import Foundation
import SupatermCLIShared

public enum ComputerUseError: Equatable, LocalizedError {
  case accessibilityPermissionMissing
  case actionFailed(Int, String)
  case elementNotFound(Int)
  case imageWriteFailed(String)
  case launchFailed(String)
  case launchTargetRequired
  case elementDisabled(Int)
  case actionUnsupported(Int, String)
  case invalidClickTarget
  case keyUnsupported(String)
  case pageExecutionFailed(String)
  case pagePermissionRequired(String)
  case pageTargetRequired
  case pageTimedOut(String)
  case pageUnsupported(String)
  case screenRecordingPermissionMissing
  case snapshotRequired
  case unsupportedBackgroundTarget
  case windowNotFound(UInt32)

  public var code: String {
    switch self {
    case .accessibilityPermissionMissing:
      return "accessibility_permission_missing"
    case .actionFailed:
      return "action_failed"
    case .elementNotFound:
      return "element_not_found"
    case .imageWriteFailed:
      return "image_write_failed"
    case .launchFailed:
      return "launch_failed"
    case .launchTargetRequired:
      return "launch_target_required"
    case .elementDisabled:
      return "element_disabled"
    case .actionUnsupported:
      return "action_unsupported"
    case .invalidClickTarget:
      return "invalid_click_target"
    case .keyUnsupported:
      return "key_unsupported"
    case .pageExecutionFailed:
      return "page_execution_failed"
    case .pagePermissionRequired:
      return "page_permission_required"
    case .pageTargetRequired:
      return "page_target_required"
    case .pageTimedOut:
      return "page_timed_out"
    case .pageUnsupported:
      return "page_unsupported"
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
    case .actionFailed(let index, let action):
      return "Element \(index) failed \(action)."
    case .elementNotFound(let index):
      return "No element with index \(index) exists in the latest snapshot."
    case .imageWriteFailed(let path):
      return "Could not write screenshot to \(path)."
    case .launchFailed(let reason):
      return reason
    case .launchTargetRequired:
      return "Provide --bundle-id or --name."
    case .elementDisabled(let index):
      return "Element \(index) is disabled."
    case .actionUnsupported(let index, let action):
      return "Element \(index) does not support \(action)."
    case .invalidClickTarget:
      return "Provide either --element or both --x and --y."
    case .keyUnsupported(let key):
      return "Unsupported key '\(key)'."
    case .pageExecutionFailed(let reason):
      return reason
    case .pagePermissionRequired(let reason):
      return reason
    case .pageTargetRequired:
      return "This page operation requires --pid and --window."
    case .pageTimedOut(let reason):
      return reason
    case .pageUnsupported(let reason):
      return reason
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
  public var screenSize: @MainActor @Sendable () async throws -> SupatermComputerUseScreenSizeResult
  public var cursorPosition: @MainActor @Sendable () async throws -> SupatermComputerUseCursorPositionResult
  public var cursorState: @MainActor @Sendable () async throws -> SupatermComputerUseCursorResult
  public var moveCursor:
    @MainActor @Sendable (SupatermComputerUseMoveCursorRequest) async throws ->
      SupatermComputerUseActionResult
  public var cursorSet:
    @MainActor @Sendable (SupatermComputerUseCursorRequest) async throws ->
      SupatermComputerUseCursorResult
  public var launch:
    @MainActor @Sendable (SupatermComputerUseLaunchRequest) async throws ->
      SupatermComputerUseLaunchResult
  public var windows:
    @MainActor @Sendable (SupatermComputerUseWindowsRequest) async throws ->
      SupatermComputerUseWindowsResult
  public var snapshot:
    @MainActor @Sendable (SupatermComputerUseSnapshotRequest) async throws ->
      SupatermComputerUseSnapshotResult
  public var screenshot:
    @MainActor @Sendable (SupatermComputerUseScreenshotRequest) async throws ->
      SupatermComputerUseScreenshot
  public var zoom:
    @MainActor @Sendable (SupatermComputerUseZoomRequest) async throws ->
      SupatermComputerUseZoomResult
  public var click:
    @MainActor @Sendable (SupatermComputerUseClickRequest) async throws ->
      SupatermComputerUseActionResult
  public var type:
    @MainActor @Sendable (SupatermComputerUseTypeRequest) async throws ->
      SupatermComputerUseActionResult
  public var key:
    @MainActor @Sendable (SupatermComputerUseKeyRequest) async throws ->
      SupatermComputerUseActionResult
  public var hotkey:
    @MainActor @Sendable (SupatermComputerUseHotkeyRequest) async throws ->
      SupatermComputerUseActionResult
  public var scroll:
    @MainActor @Sendable (SupatermComputerUseScrollRequest) async throws ->
      SupatermComputerUseActionResult
  public var setValue:
    @MainActor @Sendable (SupatermComputerUseSetValueRequest) async throws ->
      SupatermComputerUseActionResult
  public var page:
    @MainActor @Sendable (SupatermComputerUsePageRequest) async throws ->
      SupatermComputerUsePageResult
  public var recording:
    @MainActor @Sendable (SupatermComputerUseRecordingRequest) async throws ->
      SupatermComputerUseRecordingResult

  public init(
    permissions: @escaping @MainActor @Sendable () async -> SupatermComputerUsePermissionsResult,
    apps: @escaping @MainActor @Sendable () async throws -> SupatermComputerUseAppsResult,
    screenSize: @escaping @MainActor @Sendable () async throws -> SupatermComputerUseScreenSizeResult,
    cursorPosition: @escaping @MainActor @Sendable () async throws -> SupatermComputerUseCursorPositionResult,
    cursorState: @escaping @MainActor @Sendable () async throws -> SupatermComputerUseCursorResult,
    moveCursor:
      @escaping @MainActor @Sendable (
        SupatermComputerUseMoveCursorRequest
      ) async throws -> SupatermComputerUseActionResult,
    cursorSet:
      @escaping @MainActor @Sendable (
        SupatermComputerUseCursorRequest
      ) async throws -> SupatermComputerUseCursorResult,
    launch:
      @escaping @MainActor @Sendable (
        SupatermComputerUseLaunchRequest
      ) async throws -> SupatermComputerUseLaunchResult,
    windows:
      @escaping @MainActor @Sendable (
        SupatermComputerUseWindowsRequest
      ) async throws -> SupatermComputerUseWindowsResult,
    snapshot:
      @escaping @MainActor @Sendable (
        SupatermComputerUseSnapshotRequest
      ) async throws -> SupatermComputerUseSnapshotResult,
    screenshot:
      @escaping @MainActor @Sendable (
        SupatermComputerUseScreenshotRequest
      ) async throws -> SupatermComputerUseScreenshot,
    zoom:
      @escaping @MainActor @Sendable (
        SupatermComputerUseZoomRequest
      ) async throws -> SupatermComputerUseZoomResult,
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
    hotkey:
      @escaping @MainActor @Sendable (
        SupatermComputerUseHotkeyRequest
      ) async throws -> SupatermComputerUseActionResult,
    scroll:
      @escaping @MainActor @Sendable (
        SupatermComputerUseScrollRequest
      ) async throws -> SupatermComputerUseActionResult,
    setValue:
      @escaping @MainActor @Sendable (
        SupatermComputerUseSetValueRequest
      ) async throws -> SupatermComputerUseActionResult,
    page:
      @escaping @MainActor @Sendable (
        SupatermComputerUsePageRequest
      ) async throws -> SupatermComputerUsePageResult,
    recording:
      @escaping @MainActor @Sendable (
        SupatermComputerUseRecordingRequest
      ) async throws -> SupatermComputerUseRecordingResult
  ) {
    self.permissions = permissions
    self.apps = apps
    self.screenSize = screenSize
    self.cursorPosition = cursorPosition
    self.cursorState = cursorState
    self.moveCursor = moveCursor
    self.cursorSet = cursorSet
    self.launch = launch
    self.windows = windows
    self.snapshot = snapshot
    self.screenshot = screenshot
    self.zoom = zoom
    self.click = click
    self.type = type
    self.key = key
    self.hotkey = hotkey
    self.scroll = scroll
    self.setValue = setValue
    self.page = page
    self.recording = recording
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
    screenSize: {
      .init(width: 0, height: 0, scale: 1)
    },
    cursorPosition: {
      .init(x: 0, y: 0)
    },
    cursorState: {
      .init(enabled: true, alwaysFloat: false, motion: .default)
    },
    moveCursor: { _ in
      .init(ok: true, dispatch: "test")
    },
    cursorSet: { request in
      .init(
        enabled: request.enabled ?? true,
        alwaysFloat: request.alwaysFloat ?? false,
        motion: request.motion ?? .default
      )
    },
    launch: { request in
      .init(pid: 0, bundleID: request.bundleID, name: request.name ?? "", isActive: false, windows: [])
    },
    windows: { _ in
      .init(windows: [])
    },
    snapshot: { request in
      .init(pid: request.pid, windowID: request.windowID, frame: nil, elements: [], screenshot: nil)
    },
    screenshot: { request in
      .init(path: request.imageOutputPath, width: 0, height: 0)
    },
    zoom: { request in
      .init(
        pid: request.pid,
        windowID: request.windowID,
        source: .init(x: request.x, y: request.y, width: request.width, height: request.height),
        screenshot: .init(path: request.imageOutputPath, width: 0, height: 0),
        snapshotToNativeRatio: 1
      )
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
    hotkey: { _ in
      .init(ok: true, dispatch: "test")
    },
    scroll: { _ in
      .init(ok: true, dispatch: "test")
    },
    setValue: { _ in
      .init(ok: true, dispatch: "test")
    },
    page: { request in
      .init(action: request.action, dispatch: "test")
    },
    recording: { request in
      .init(active: request.action == .start, directory: request.directory)
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
      screenSize: {
        runtime.screenSize()
      },
      cursorPosition: {
        runtime.cursorPosition()
      },
      cursorState: {
        runtime.cursorState()
      },
      moveCursor: { request in
        try runtime.moveCursor(request)
      },
      cursorSet: { request in
        try runtime.cursorSet(request)
      },
      launch: { request in
        try await runtime.launch(request)
      },
      windows: { request in
        runtime.windows(request)
      },
      snapshot: { request in
        try await runtime.snapshot(request)
      },
      screenshot: { request in
        try await runtime.screenshot(request)
      },
      zoom: { request in
        try await runtime.zoom(request)
      },
      click: { request in
        try await runtime.click(request)
      },
      type: { request in
        try await runtime.type(request)
      },
      key: { request in
        try await runtime.key(request)
      },
      hotkey: { request in
        try await runtime.hotkey(request)
      },
      scroll: { request in
        try await runtime.scroll(request)
      },
      setValue: { request in
        try await runtime.setValue(request)
      },
      page: { request in
        try await runtime.page(request)
      },
      recording: { request in
        try await runtime.recording(request)
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
