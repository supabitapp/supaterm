import ComposableArchitecture
import Foundation
import SupatermComputerUseFeature
import SupatermSocketFeature
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SocketControlFeatureComputerUseTests {
  @Test
  func permissionsRequestRepliesWithPermissionStatus() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "D03E7431-2355-4012-B423-0302B43D8262")!
    let expected = SupatermComputerUsePermissionsResult(
      accessibility: .granted,
      screenRecording: .missing
    )
    let store = makeStore {
      $0.computerUseClient.permissions = { expected }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    await store.send(
      .requestReceived(
        .init(handle: handle, payload: .computerUsePermissions(id: "computer-use-permissions"))
      )
    )

    let records = await recorder.snapshot()
    #expect(records.first?.handle == handle)
    #expect(
      try records.first?.response.decodeResult(SupatermComputerUsePermissionsResult.self)
        == expected)
  }

  @Test
  func snapshotRequestRoutesPayloadToComputerUseClient() async throws {
    let recorder = SocketReplyRecorder()
    let payload = SupatermComputerUseSnapshotRequest(
      pid: 123,
      windowID: 456,
      imageOutputPath: "/tmp/window.png"
    )
    let expected = SupatermComputerUseSnapshotResult(
      pid: 123,
      windowID: 456,
      frame: .init(x: 1, y: 2, width: 300, height: 200),
      elements: [
        .init(
          elementIndex: 1,
          role: "AXButton",
          title: "OK",
          value: nil,
          description: "Confirm",
          identifier: "confirm-button",
          help: "Confirm selection",
          frame: nil,
          isEnabled: true,
          isFocused: false
        )
      ],
      screenshot: .init(path: "/tmp/window.png", width: 300, height: 200)
    )
    let seenPayload = ComputerUseSnapshotRecorder()
    let handle = UUID(uuidString: "2F892312-025F-4DCD-A71A-11D95F5B69AA")!
    let store = makeStore {
      $0.computerUseClient.snapshot = { request in
        await seenPayload.record(request)
        return expected
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    await store.send(
      .requestReceived(
        .init(
          handle: handle, payload: try .computerUseSnapshot(payload, id: "computer-use-snapshot"))
      )
    )

    #expect(await seenPayload.snapshot() == payload)
    #expect(
      try await recorder.snapshot().first?.response.decodeResult(
        SupatermComputerUseSnapshotResult.self) == expected)
  }

  @Test
  func elementDisplayTextFallsBackToAccessibilitySemantics() {
    let element = SupatermComputerUseElement(
      elementIndex: 1,
      role: "AXButton",
      title: nil,
      value: nil,
      description: "Seven",
      identifier: "Seven",
      help: nil,
      frame: nil,
      isEnabled: true,
      isFocused: false
    )

    #expect(element.displayText == "Seven")
  }

  @Test
  func computerUseErrorsUseStableCodes() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "31046B10-9DD0-4BBF-A204-B0F1A92D41FC")!
    let payload = SupatermComputerUseClickRequest(pid: 123, windowID: 456, elementIndex: 1)
    let store = makeStore {
      $0.computerUseClient.click = { _ in
        throw ComputerUseError.snapshotRequired
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    await store.send(
      .requestReceived(
        .init(handle: handle, payload: try .computerUseClick(payload, id: "computer-use-click"))
      )
    )

    let response = try #require(await recorder.snapshot().first?.response)
    #expect(!response.ok)
    #expect(response.error?.code == "snapshot_required")
  }
}

private actor ComputerUseSnapshotRecorder {
  private var payload: SupatermComputerUseSnapshotRequest?

  func record(_ payload: SupatermComputerUseSnapshotRequest) {
    self.payload = payload
  }

  func snapshot() -> SupatermComputerUseSnapshotRequest? {
    payload
  }
}
