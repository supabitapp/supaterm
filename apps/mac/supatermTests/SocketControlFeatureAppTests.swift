import ComposableArchitecture
import Foundation
import Sharing
import SupatermSocketFeature
import SupatermSupport
import SupatermTerminalCore
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SocketControlFeatureAppTests {
  @Test
  func treeRequestRepliesWithSnapshot() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "92B503AB-CC76-4D91-A024-FD4D400F0446")!
    let pane = SupatermTreeSnapshot.Pane(
      index: 1,
      id: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!,
      isFocused: true
    )
    let tab = SupatermTreeSnapshot.Tab(
      index: 1,
      id: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      title: "zsh",
      isSelected: true,
      panes: [pane]
    )
    let space = SupatermTreeSnapshot.Space(
      index: 1,
      id: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      name: "A",
      isSelected: true,
      tabs: [tab]
    )
    let window = SupatermTreeSnapshot.Window(
      index: 1,
      isKey: true,
      spaces: [space]
    )
    let snapshot = SupatermTreeSnapshot(
      windows: [window]
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .tree(id: "tree-1")
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.treeSnapshot = { snapshot }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermTreeSnapshot.self) == snapshot)
  }
  @Test
  func onboardingRequestRepliesWithSnapshot() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "120B0BA1-4524-4C63-A0E6-CAC1327E7350")!
    let snapshot = SupatermOnboardingSnapshot(
      items: [
        SupatermOnboardingShortcut(shortcut: "⌘S", title: "Toggle sidebar"),
        SupatermOnboardingShortcut(shortcut: "⌘T", title: "New tab"),
      ]
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .onboarding(id: "onboarding-1")
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.onboardingSnapshot = { snapshot }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermOnboardingSnapshot.self) == snapshot)
  }
  @Test
  func debugRequestRepliesWithSnapshot() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "E8ECEDC8-C9D7-4127-9D7D-7C58A42C0F35")!
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "BEB80BB0-902E-4E56-AF34-A57A613F977A")!,
      tabID: UUID(uuidString: "3B9FB2DD-0C6E-4AE0-BE47-328F70A5A315")!
    )
    let snapshot = SupatermAppDebugSnapshot(
      build: SupatermAppDebugSnapshot.Build(
        version: "1.2.3",
        buildNumber: "45",
        isDevelopmentBuild: true,
        usesStubUpdateChecks: false
      ),
      update: SupatermAppDebugSnapshot.Update(
        canCheckForUpdates: true,
        phase: "checking",
        detail: "Please wait while Supaterm checks for available updates."
      ),
      summary: SupatermAppDebugSnapshot.Summary(
        windowCount: 1,
        spaceCount: 0,
        tabCount: 0,
        paneCount: 0,
        keyWindowIndex: 1
      ),
      currentTarget: nil,
      windows: [],
      problems: ["No active windows."]
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .debug(SupatermDebugRequest(context: context), id: "debug-1")
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.terminalWindowsClient.debugSnapshot = { request in
        #expect(request == SupatermDebugRequest(context: context))
        return snapshot
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(records.first?.handle == handle)
    #expect(try records.first?.response.decodeResult(SupatermAppDebugSnapshot.self) == snapshot)
  }
  @Test
  func unknownMethodRepliesWithStructuredError() async {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "B12602E1-5D37-470E-9388-55CD09D400CA")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: SupatermSocketRequest(id: "request-2", method: "space.list")
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(
      records.first
        == SocketReplyRecorder.Record(
          handle: handle,
          response: .error(
            id: "request-2",
            code: "method_not_found",
            message: "Unknown method 'space.list'."
          )
        )
    )
  }
  @Test
  func onboardingRequestWithoutWindowRepliesWithStructuredError() async {
    let recorder = SocketReplyRecorder()
    let handle = UUID(uuidString: "7B0A8AAE-F4B3-48B6-B5CA-B9D9A7E55DA0")!
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .onboarding(id: "onboarding-2")
    )

    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
    }

    await store.send(.requestReceived(request))

    let records = await recorder.snapshot()
    #expect(records.count == 1)
    #expect(
      records.first
        == SocketReplyRecorder.Record(
          handle: handle,
          response: .error(
            id: "onboarding-2",
            code: "invalid_request",
            message: "No Supaterm window is available."
          )
        )
    )
  }
}
