import ComposableArchitecture
import Foundation
import SupatermSocketFeature
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SocketControlFeatureTabMoveTests {
  @Test
  func moveTabRequestRepliesWithMovedTarget() async throws {
    let recorder = SocketReplyRecorder()
    let request = SupatermMoveTabRequest(
      index: 3,
      isPinned: true,
      projectID: UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!,
      target: SupatermTabTargetRequest(tabID: tabMoveTestTabID)
    )
    let result = SupatermMoveTabResult(
      target: SupatermTabTarget(
        windowIndex: 1,
        spaceIndex: 2,
        spaceID: tabMoveTestSpaceID,
        tabIndex: 1,
        tabID: tabMoveTestTabID,
        title: "Build"
      )
    )
    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalTab = { execution in
        guard case .moveTab(let moved) = execution else {
          Issue.record("Expected move tab request")
          throw CancellationError()
        }
        #expect(moved == request)
        return .moveTab(result)
      }
    }

    await store.send(
      .requestReceived(
        SocketControlClient.Request(
          handle: UUID(),
          payload: try .moveTab(request, id: "move")
        )
      )
    )

    let response = try #require(await recorder.snapshot().first?.response)
    #expect(try response.decodeResult(SupatermMoveTabResult.self) == result)
  }

  @Test
  func moveTabRejectsZeroBeforeExecution() async throws {
    let recorder = SocketReplyRecorder()
    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalTab = { _ in
        Issue.record("Move tab should not execute")
        throw CancellationError()
      }
    }

    await store.send(
      .requestReceived(
        SocketControlClient.Request(
          handle: UUID(),
          payload: try .moveTab(
            SupatermMoveTabRequest(
              index: 0,
              isPinned: false,
              projectID: nil,
              target: SupatermTabTargetRequest(tabID: tabMoveTestTabID)
            ),
            id: "move"
          )
        )
      )
    )

    let response = try #require(await recorder.snapshot().first?.response)
    #expect(response.error?.code == "invalid_request")
    #expect(response.error?.message == "index must be 1 or greater.")
  }

  @Test
  func moveTabReportsOutOfRangeIndexAsInvalidRequest() async throws {
    let recorder = SocketReplyRecorder()
    let store = makeStore {
      $0.socketControlClient.reply = { handle, response in
        await recorder.record(handle: handle, response: response)
      }
      $0.socketRequestExecutor.executeTerminalTab = { _ in
        throw TerminalTabCommandError.invalidRequest(
          "Tab index 99 is outside the destination section."
        )
      }
    }

    await store.send(
      .requestReceived(
        SocketControlClient.Request(
          handle: UUID(),
          payload: try .moveTab(
            SupatermMoveTabRequest(
              index: 99,
              isPinned: false,
              projectID: nil,
              target: SupatermTabTargetRequest(tabID: tabMoveTestTabID)
            ),
            id: "move"
          )
        )
      )
    )

    let response = try #require(await recorder.snapshot().first?.response)
    #expect(response.error?.code == "invalid_request")
    #expect(response.error?.message == "Tab index 99 is outside the destination section.")
  }
}

private let tabMoveTestSpaceID = UUID(
  uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497"
)!
private let tabMoveTestTabID = UUID(
  uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B"
)!
