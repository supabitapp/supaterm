import AppKit
import ApplicationServices
import ComposableArchitecture
import CoreGraphics
import ScreenCaptureKit

public enum ComputerUsePermissionKind: String, CaseIterable, Equatable, Identifiable, Sendable {
  case accessibility
  case screenRecording

  public var id: String {
    rawValue
  }
}

public enum ComputerUsePermissionStatus: Equatable, Sendable {
  case unknown
  case granted
  case missing
}

public struct ComputerUsePermissionsSnapshot: Equatable, Sendable {
  public let accessibility: ComputerUsePermissionStatus
  public let screenRecording: ComputerUsePermissionStatus

  public init(
    accessibility: ComputerUsePermissionStatus,
    screenRecording: ComputerUsePermissionStatus
  ) {
    self.accessibility = accessibility
    self.screenRecording = screenRecording
  }
}

struct ComputerUsePermissionsClient: Sendable {
  var snapshot: @MainActor @Sendable () async -> ComputerUsePermissionsSnapshot
  var request: @MainActor @Sendable (ComputerUsePermissionKind) async -> ComputerUsePermissionsSnapshot
  var openSettings: @MainActor @Sendable (ComputerUsePermissionKind) async -> Void
}

extension ComputerUsePermissionsClient: DependencyKey {
  static let liveValue = Self(
    snapshot: {
      await Self.currentSnapshot()
    },
    request: { kind in
      switch kind {
      case .accessibility:
        _ = AXIsProcessTrustedWithOptions(["AXTrustedCheckOptionPrompt": true] as CFDictionary)
      case .screenRecording:
        _ = CGRequestScreenCaptureAccess()
      }
      return await Self.currentSnapshot()
    },
    openSettings: { kind in
      let urlString: String
      switch kind {
      case .accessibility:
        urlString = "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
      case .screenRecording:
        urlString = "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
      }
      guard let url = URL(string: urlString) else { return }
      NSWorkspace.shared.open(url)
    }
  )

  static let testValue = Self(
    snapshot: {
      .init(accessibility: .missing, screenRecording: .missing)
    },
    request: { _ in
      .init(accessibility: .missing, screenRecording: .missing)
    },
    openSettings: { _ in }
  )

  private static func currentSnapshot() async -> ComputerUsePermissionsSnapshot {
    async let screenRecording = screenRecordingGranted()
    return await .init(
      accessibility: AXIsProcessTrusted() ? .granted : .missing,
      screenRecording: screenRecording ? .granted : .missing
    )
  }

  private static func screenRecordingGranted() async -> Bool {
    do {
      _ = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
      return true
    } catch {
      return false
    }
  }
}

extension DependencyValues {
  var computerUsePermissionsClient: ComputerUsePermissionsClient {
    get { self[ComputerUsePermissionsClient.self] }
    set { self[ComputerUsePermissionsClient.self] = newValue }
  }
}
