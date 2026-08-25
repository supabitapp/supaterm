import ComposableArchitecture
import Foundation
import SupatermSocketFeature
import SupatermTerminalCore
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SocketControlFeatureProjectTests {
  @Test
  func mutationMethodsRouteProjectRequests() async throws {
    let recorder = TerminalProjectRequestRecorder()
    let replyRecorder = SocketReplyRecorder()
    let target = SupatermProjectTargetRequest(projectID: projectTestID)
    let fixtures: [(SupatermSocketRequest, TerminalProjectRequest)] = [
      (
        try .addProject(
          SupatermAddProjectRequest(
            color: .green,
            isPinned: true,
            name: "Work",
            rootPath: "/tmp/work"
          ),
          id: "add"
        ),
        .add(
          SupatermAddProjectRequest(
            color: .green,
            isPinned: true,
            name: "Work",
            rootPath: "/tmp/work"
          )
        )
      ),
      (
        try .renameProject(
          SupatermRenameProjectRequest(name: "Build", target: target),
          id: "rename"
        ),
        .rename(SupatermRenameProjectRequest(name: "Build", target: target))
      ),
      (
        try .setProjectColor(
          SupatermSetProjectColorRequest(color: .purple, target: target),
          id: "color"
        ),
        .setColor(SupatermSetProjectColorRequest(color: .purple, target: target))
      ),
      (
        try .reorderProject(
          SupatermReorderProjectRequest(index: 4, target: target),
          id: "reorder"
        ),
        .reorder(SupatermReorderProjectRequest(index: 4, target: target))
      ),
      (try .pinProject(target, id: "pin"), .pin(target)),
      (try .unpinProject(target, id: "unpin"), .unpin(target)),
    ]
    let store = makeProjectStore(replyRecorder: replyRecorder) { request in
      await recorder.record(request)
      return .project(projectTestMutationResult)
    }

    for fixture in fixtures {
      await store.send(
        .requestReceived(SocketControlClient.Request(handle: UUID(), payload: fixture.0))
      )
    }

    #expect(await recorder.snapshot() == fixtures.map(\.1))
    let replies = await replyRecorder.snapshot()
    #expect(replies.count == fixtures.count)
    for reply in replies {
      #expect(
        try reply.response.decodeResult(SupatermProjectMutationResult.self)
          == projectTestMutationResult
      )
    }
  }

  @Test
  func collapseReturnsTheChangedSection() async throws {
    let recorder = TerminalProjectRequestRecorder()
    let replyRecorder = SocketReplyRecorder()
    let request = SupatermSetProjectCollapsedRequest(
      isCollapsed: true,
      projectID: nil,
      spaceID: projectTestSpaceID
    )
    let result = SupatermSetProjectCollapsedResult(
      isCollapsed: request.isCollapsed,
      projectID: request.projectID,
      spaceID: request.spaceID
    )
    let store = makeProjectStore(replyRecorder: replyRecorder) { operation in
      await recorder.record(operation)
      return .collapsed(result)
    }

    await store.send(
      .requestReceived(
        SocketControlClient.Request(
          handle: UUID(),
          payload: try .setProjectCollapsed(request, id: "collapse")
        )
      )
    )

    #expect(await recorder.snapshot() == [.setCollapsed(request)])
    let reply = try #require(await replyRecorder.snapshot().first)
    #expect(try reply.response.decodeResult(SupatermSetProjectCollapsedResult.self) == result)
  }

  @Test
  func removalRoutesConfirmationAndReturnsRemovedTabs() async throws {
    let recorder = TerminalProjectRequestRecorder()
    let replyRecorder = SocketReplyRecorder()
    let request = SupatermRemoveProjectRequest(
      confirmed: true,
      target: SupatermProjectTargetRequest(projectID: projectTestID)
    )
    let result = SupatermRemoveProjectResult(
      removedProjectID: projectTestID,
      removedTabIDs: [projectTestTabID]
    )
    let store = makeProjectStore(replyRecorder: replyRecorder) { operation in
      await recorder.record(operation)
      return .removedProject(result)
    }

    await store.send(
      .requestReceived(
        SocketControlClient.Request(
          handle: UUID(),
          payload: try .removeProject(request, id: "remove")
        )
      )
    )

    #expect(await recorder.snapshot() == [.remove(request)])
    let reply = try #require(await replyRecorder.snapshot().first)
    #expect(try reply.response.decodeResult(SupatermRemoveProjectResult.self) == result)
  }

  @Test
  func moveTabPreservesProjectAndPinLane() async throws {
    let recorder = TerminalProjectRequestRecorder()
    let replyRecorder = SocketReplyRecorder()
    let request = SupatermMoveTabRequest(
      index: 3,
      isPinned: true,
      projectID: projectTestID,
      target: SupatermTabTargetRequest(tabID: projectTestTabID)
    )
    let result = SupatermMoveTabResult(
      target: SupatermTabTarget(
        windowIndex: 1,
        spaceIndex: 2,
        spaceID: projectTestSpaceID,
        tabIndex: 1,
        tabID: projectTestTabID,
        title: "Build"
      )
    )
    let store = makeProjectStore(replyRecorder: replyRecorder) { operation in
      await recorder.record(operation)
      return .movedTab(result)
    }

    await store.send(
      .requestReceived(
        SocketControlClient.Request(
          handle: UUID(),
          payload: try .moveTab(request, id: "move")
        )
      )
    )

    #expect(await recorder.snapshot() == [.moveTab(request)])
    let reply = try #require(await replyRecorder.snapshot().first)
    #expect(try reply.response.decodeResult(SupatermMoveTabResult.self) == result)
  }

  @Test
  func reorderAndMoveRejectZeroBeforeExecution() async throws {
    let recorder = TerminalProjectRequestRecorder()
    let replyRecorder = SocketReplyRecorder()
    let target = SupatermProjectTargetRequest(projectID: projectTestID)
    let store = makeProjectStore(replyRecorder: replyRecorder) { operation in
      await recorder.record(operation)
      return .project(projectTestMutationResult)
    }
    let requests = [
      try SupatermSocketRequest.reorderProject(
        SupatermReorderProjectRequest(index: 0, target: target),
        id: "reorder"
      ),
      try SupatermSocketRequest.moveTab(
        SupatermMoveTabRequest(
          index: 0,
          isPinned: false,
          projectID: nil,
          target: SupatermTabTargetRequest(tabID: projectTestTabID)
        ),
        id: "move"
      ),
    ]

    for request in requests {
      await store.send(
        .requestReceived(SocketControlClient.Request(handle: UUID(), payload: request))
      )
    }

    #expect(await recorder.snapshot().isEmpty)
    let replies = await replyRecorder.snapshot()
    #expect(replies.count == 2)
    #expect(replies.allSatisfy { $0.response.error?.code == "invalid_request" })
    #expect(replies.allSatisfy { $0.response.error?.message == "index must be 1 or greater." })
  }
}

private let projectTestID = UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!
private let projectTestSpaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
private let projectTestTabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!

private let projectTestMutationResult = SupatermProjectMutationResult(
  project: SupatermSnapshotProject(
    color: .green,
    id: projectTestID,
    isPinned: true,
    name: "Work",
    rootPath: "/tmp/work"
  )
)

@MainActor
private func makeProjectStore(
  replyRecorder: SocketReplyRecorder,
  execute:
    @escaping @MainActor @Sendable (
      TerminalProjectRequest
    ) async throws -> TerminalProjectResult
) -> TestStoreOf<SocketControlFeature> {
  TestStore(initialState: SocketControlFeature.State()) {
    SocketControlFeature()
  } withDependencies: {
    $0.socketControlClient.isPending = { _ in true }
    $0.socketControlClient.reply = { handle, response in
      await replyRecorder.record(handle: handle, response: response)
    }
    $0.socketRequestExecutor = .testing(executeTerminalProject: execute)
  }
}

private actor TerminalProjectRequestRecorder {
  private var requests: [TerminalProjectRequest] = []

  func record(_ request: TerminalProjectRequest) {
    requests.append(request)
  }

  func snapshot() -> [TerminalProjectRequest] {
    requests
  }
}
