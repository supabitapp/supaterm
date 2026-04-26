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
  func launchRequestRoutesPayloadToComputerUseClient() async throws {
    let recorder = SocketReplyRecorder()
    let seenPayload = ComputerUseLaunchRecorder()
    let handle = UUID(uuidString: "7603345C-4311-4919-9724-A2A4A9AC5D97")!
    let payload = SupatermComputerUseLaunchRequest(
      bundleID: "com.apple.TextEdit",
      urls: ["file:///tmp/example.txt"],
      arguments: ["--foreground"],
      environment: ["FOO": "bar"],
      createsNewInstance: true
    )
    let expected = SupatermComputerUseLaunchResult(
      pid: 123,
      bundleID: "com.apple.TextEdit",
      name: "TextEdit",
      isActive: false,
      windows: [
        .init(
          id: 456,
          pid: 123,
          appName: "TextEdit",
          title: "example.txt",
          frame: .init(x: 0, y: 0, width: 800, height: 600),
          isOnScreen: true,
          zIndex: 1,
          layer: 0,
          onCurrentSpace: true,
          spaceIDs: [1]
        )
      ]
    )
    let store = makeStore {
      $0.computerUseClient.launch = { request in
        await seenPayload.record(request)
        return expected
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    await store.send(
      .requestReceived(
        .init(handle: handle, payload: try .computerUseLaunch(payload, id: "computer-use-launch"))
      )
    )

    #expect(await seenPayload.snapshot() == payload)
    #expect(
      try await recorder.snapshot().first?.response.decodeResult(
        SupatermComputerUseLaunchResult.self) == expected)
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

  @Test
  func clickRequestRoutesClickOptionsToComputerUseClient() async throws {
    let recorder = SocketReplyRecorder()
    let seenPayload = ComputerUseClickRecorder()
    let handle = UUID(uuidString: "CF42DC57-7D57-4F8C-BBC4-951450282287")!
    let payload = SupatermComputerUseClickRequest(
      pid: 123,
      windowID: 456,
      x: 20,
      y: 30,
      button: .right,
      count: 2,
      modifiers: [.command, .option]
    )
    let store = makeStore {
      $0.computerUseClient.click = { request in
        await seenPayload.record(request)
        return .init(ok: true, dispatch: "pid_event")
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

    #expect(await seenPayload.snapshot() == payload)
    #expect(
      try await recorder.snapshot().first?.response.decodeResult(
        SupatermComputerUseActionResult.self) == .init(ok: true, dispatch: "pid_event"))
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

private actor ComputerUseClickRecorder {
  private var payload: SupatermComputerUseClickRequest?

  func record(_ payload: SupatermComputerUseClickRequest) {
    self.payload = payload
  }

  func snapshot() -> SupatermComputerUseClickRequest? {
    payload
  }
}

private actor ComputerUseLaunchRecorder {
  private var payload: SupatermComputerUseLaunchRequest?

  func record(_ payload: SupatermComputerUseLaunchRequest) {
    self.payload = payload
  }

  func snapshot() -> SupatermComputerUseLaunchRequest? {
    payload
  }
}
