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
        SocketControlClient.Request(handle: handle, payload: .computerUsePermissions(id: "computer-use-permissions"))
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
      frame: SupatermComputerUseRect(x: 1, y: 2, width: 300, height: 200),
      elements: [
        SupatermComputerUseElement(
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
      screenshot: SupatermComputerUseScreenshot(path: "/tmp/window.png", width: 300, height: 200)
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
        SocketControlClient.Request(
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
      electronDebuggingPort: 9222,
      webkitInspectorPort: 9226,
      createsNewInstance: true
    )
    let expected = SupatermComputerUseLaunchResult(
      pid: 123,
      bundleID: "com.apple.TextEdit",
      name: "TextEdit",
      isActive: false,
      windows: [
        SupatermComputerUseWindow(
          id: 456,
          pid: 123,
          appName: "TextEdit",
          title: "example.txt",
          frame: SupatermComputerUseRect(x: 0, y: 0, width: 800, height: 600),
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
        SocketControlClient.Request(handle: handle, payload: try .computerUseLaunch(payload, id: "computer-use-launch"))
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
        SocketControlClient.Request(handle: handle, payload: try .computerUseClick(payload, id: "computer-use-click"))
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
        return SupatermComputerUseActionResult(ok: true, dispatch: "pid_event")
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    await store.send(
      .requestReceived(
        SocketControlClient.Request(handle: handle, payload: try .computerUseClick(payload, id: "computer-use-click"))
      )
    )

    #expect(await seenPayload.snapshot() == payload)
    #expect(
      try await recorder.snapshot().first?.response.decodeResult(
        SupatermComputerUseActionResult.self) == SupatermComputerUseActionResult(ok: true, dispatch: "pid_event"))
  }

  @Test
  func pageRequestRoutesPayloadToComputerUseClient() async throws {
    let recorder = SocketReplyRecorder()
    let seenPayload = ComputerUsePageRecorder()
    let handle = UUID(uuidString: "549DD74E-D8EB-45E6-B293-869689231985")!
    let payload = SupatermComputerUsePageRequest(
      pid: 123,
      windowID: 456,
      action: .queryDOM,
      cssSelector: "a",
      attributes: ["href"]
    )
    let expected = SupatermComputerUsePageResult(
      action: .queryDOM,
      dispatch: "accessibility_tree",
      json: .array([.object(["tag": .string("a"), "text": .string("Docs")])])
    )
    let store = makeStore {
      $0.computerUseClient.page = { request in
        await seenPayload.record(request)
        return expected
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    await store.send(
      .requestReceived(
        SocketControlClient.Request(handle: handle, payload: try .computerUsePage(payload, id: "computer-use-page"))
      )
    )

    #expect(await seenPayload.snapshot() == payload)
    #expect(
      try await recorder.snapshot().first?.response.decodeResult(
        SupatermComputerUsePageResult.self) == expected)
  }

  @Test
  func utilityRequestsRoutePayloadsToComputerUseClient() async throws {
    let recorder = SocketReplyRecorder()
    let zoomRecorder = ComputerUsePayloadRecorder<SupatermComputerUseZoomRequest>()
    let recordingRecorder = ComputerUsePayloadRecorder<SupatermComputerUseRecordingRequest>()
    let hotkeyRecorder = ComputerUsePayloadRecorder<SupatermComputerUseHotkeyRequest>()
    let screenSize = SupatermComputerUseScreenSizeResult(width: 1512, height: 982, scale: 2)
    let zoomPayload = SupatermComputerUseZoomRequest(
      pid: 123,
      windowID: 456,
      x: 1,
      y: 2,
      width: 30,
      height: 40,
      imageOutputPath: "/tmp/zoom.png"
    )
    let zoomResult = SupatermComputerUseZoomResult(
      pid: 123,
      windowID: 456,
      source: SupatermComputerUseRect(x: 1, y: 2, width: 30, height: 40),
      screenshot: SupatermComputerUseScreenshot(path: "/tmp/zoom.png", width: 30, height: 40),
      snapshotToNativeRatio: 2
    )
    let recordingPayload = SupatermComputerUseRecordingRequest(action: .replay, directory: "/tmp/run")
    let recordingResult = SupatermComputerUseRecordingResult(
      active: false,
      directory: "/tmp/run",
      turns: 3,
      succeeded: 3,
      failed: 0
    )
    let hotkeyPayload = SupatermComputerUseHotkeyRequest(
      pid: 123,
      windowID: 456,
      keys: ["cmd+shift+p"]
    )
    let hotkeyResult = SupatermComputerUseActionResult(ok: true, dispatch: "pid_event")
    let store = makeStore {
      $0.computerUseClient.screenSize = { screenSize }
      $0.computerUseClient.zoom = { request in
        await zoomRecorder.record(request)
        return zoomResult
      }
      $0.computerUseClient.recording = { request in
        await recordingRecorder.record(request)
        return recordingResult
      }
      $0.computerUseClient.hotkey = { request in
        await hotkeyRecorder.record(request)
        return hotkeyResult
      }
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    let screenHandle = UUID(uuidString: "1F9C05E8-13D3-4F25-97B4-24592B8129EC")!
    await store.send(
      .requestReceived(SocketControlClient.Request(handle: screenHandle, payload: .computerUseScreenSize(id: "screen-size")))
    )
    let zoomHandle = UUID(uuidString: "35F7AF90-476B-49FB-9C42-91107D2636D2")!
    await store.send(
      .requestReceived(
        SocketControlClient.Request(handle: zoomHandle, payload: try .computerUseZoom(zoomPayload, id: "zoom"))
      )
    )
    let recordingHandle = UUID(uuidString: "7F18F082-C4C2-46A8-9F1A-20B6A41B852D")!
    await store.send(
      .requestReceived(
        SocketControlClient.Request(
          handle: recordingHandle,
          payload: try .computerUseRecording(recordingPayload, id: "recording")
        )
      )
    )
    let hotkeyHandle = UUID(uuidString: "8D63E6CB-8B5E-491C-937B-58578E1C76AD")!
    await store.send(
      .requestReceived(
        SocketControlClient.Request(handle: hotkeyHandle, payload: try .computerUseHotkey(hotkeyPayload, id: "hotkey"))
      )
    )

    let responses = await recorder.snapshot()
    #expect(try responses[0].response.decodeResult(SupatermComputerUseScreenSizeResult.self) == screenSize)
    #expect(await zoomRecorder.snapshot() == zoomPayload)
    #expect(try responses[1].response.decodeResult(SupatermComputerUseZoomResult.self) == zoomResult)
    #expect(await recordingRecorder.snapshot() == recordingPayload)
    #expect(
      try responses[2].response.decodeResult(SupatermComputerUseRecordingResult.self)
        == recordingResult)
    #expect(await hotkeyRecorder.snapshot() == hotkeyPayload)
    #expect(try responses[3].response.decodeResult(SupatermComputerUseActionResult.self) == hotkeyResult)
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

private actor ComputerUsePageRecorder {
  private var payload: SupatermComputerUsePageRequest?

  func record(_ payload: SupatermComputerUsePageRequest) {
    self.payload = payload
  }

  func snapshot() -> SupatermComputerUsePageRequest? {
    payload
  }
}

private actor ComputerUsePayloadRecorder<Payload: Sendable> {
  private var payload: Payload?

  func record(_ payload: Payload) {
    self.payload = payload
  }

  func snapshot() -> Payload? {
    payload
  }
}
