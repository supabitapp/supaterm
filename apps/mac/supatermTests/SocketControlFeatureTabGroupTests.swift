import ComposableArchitecture
import Foundation
import SupatermSocketFeature
import SupatermTerminalCore
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct SocketControlFeatureTabGroupTests {
  @Test
  func mutationMethodsRouteConcreteGroupRequests() async throws {
    let recorder = TerminalTabGroupRequestRecorder()
    let replyRecorder = SocketReplyRecorder()
    let groupID = tabGroupTestGroupID
    let target = SupatermTabGroupTargetRequest(groupID: groupID)
    let fixtures: [(SupatermSocketRequest, TerminalTabGroupRequest)] = [
      (
        try .createTabGroup(
          SupatermCreateTabGroupRequest(
            color: .green,
            isPinned: true,
            target: SupatermSpaceTargetRequest(spaceID: tabGroupTestSpaceID),
            title: "Work"
          ),
          id: "create"
        ),
        .create(
          TerminalCreateTabGroupRequest(
            color: .green,
            isPinned: true,
            target: TerminalSpaceTarget(spaceID: tabGroupTestSpaceID),
            title: "Work"
          )
        )
      ),
      (
        try .renameTabGroup(
          SupatermRenameTabGroupRequest(title: "Build", target: target),
          id: "rename"
        ),
        .rename(TerminalRenameTabGroupRequest(groupID: groupID, title: "Build"))
      ),
      (
        try .setTabGroupColor(
          SupatermSetTabGroupColorRequest(color: .purple, target: target),
          id: "color"
        ),
        .setColor(TerminalSetTabGroupColorRequest(color: .purple, groupID: groupID))
      ),
      (
        try .collapseTabGroup(target, id: "collapse"),
        .setCollapsed(TerminalSetTabGroupCollapsedRequest(groupID: groupID, isCollapsed: true))
      ),
      (
        try .expandTabGroup(target, id: "expand"),
        .setCollapsed(TerminalSetTabGroupCollapsedRequest(groupID: groupID, isCollapsed: false))
      ),
      (
        try .moveTabGroup(
          SupatermMoveTabGroupRequest(index: 1, target: target),
          id: "move-first"
        ),
        .move(TerminalMoveTabGroupRequest(groupID: groupID, index: 0))
      ),
      (
        try .moveTabGroup(
          SupatermMoveTabGroupRequest(index: 4, target: target),
          id: "move-end"
        ),
        .move(TerminalMoveTabGroupRequest(groupID: groupID, index: 3))
      ),
      (try .pinTabGroup(target, id: "pin"), .pin(groupID)),
      (try .unpinTabGroup(target, id: "unpin"), .unpin(groupID)),
    ]
    let store = makeTabGroupStore(
      replyRecorder: replyRecorder,
      execute: { request in
        await recorder.record(request)
        return .group(tabGroupTestMutationResult)
      }
    )

    for fixture in fixtures {
      await store.send(
        .requestReceived(
          SocketControlClient.Request(handle: UUID(), payload: fixture.0)
        )
      )
    }

    #expect(await recorder.snapshot() == fixtures.map(\.1))
    let replies = await replyRecorder.snapshot()
    #expect(replies.count == fixtures.count)
    for record in replies {
      #expect(
        try record.response.decodeResult(SupatermTabGroupMutationResult.self)
          == tabGroupTestMutationResult
      )
    }
  }

  @Test
  func removalMethodsRouteGroupIDAndReturnCanonicalRemoval() async throws {
    let recorder = TerminalTabGroupRequestRecorder()
    let replyRecorder = SocketReplyRecorder()
    let target = SupatermTabGroupTargetRequest(groupID: tabGroupTestGroupID)
    let store = makeTabGroupStore(
      replyRecorder: replyRecorder,
      execute: { request in
        await recorder.record(request)
        return .removedGroup(tabGroupTestRemovalResult)
      }
    )

    await store.send(
      .requestReceived(
        SocketControlClient.Request(
          handle: UUID(),
          payload: try .ungroupTabGroup(target, id: "ungroup")
        )
      )
    )
    await store.send(
      .requestReceived(
        SocketControlClient.Request(
          handle: UUID(),
          payload: try .closeTabGroup(target, id: "close")
        )
      )
    )

    #expect(await recorder.snapshot() == [.ungroup(tabGroupTestGroupID), .close(tabGroupTestGroupID)])
    let replies = await replyRecorder.snapshot()
    #expect(replies.count == 2)
    for record in replies {
      #expect(
        try record.response.decodeResult(SupatermRemoveTabGroupResult.self)
          == tabGroupTestRemovalResult
      )
    }
  }

  @Test
  func moveTabConvertsPublicIndexesExactlyOnce() async throws {
    let recorder = TerminalTabGroupRequestRecorder()
    let replyRecorder = SocketReplyRecorder()
    let target = SupatermTabTargetRequest(
      tabID: tabGroupTestTabID
    )
    let fixtures: [(SupatermSocketRequest, TerminalMoveTabDestination)] = [
      (
        try .moveTab(
          SupatermMoveTabRequest(
            destination: .group(tabGroupTestGroupID),
            index: 1,
            target: target
          ),
          id: "group-first"
        ),
        .group(id: tabGroupTestGroupID, index: 0)
      ),
      (
        try .moveTab(
          SupatermMoveTabRequest(
            destination: .group(tabGroupTestGroupID),
            index: 4,
            target: target
          ),
          id: "group-end"
        ),
        .group(id: tabGroupTestGroupID, index: 3)
      ),
      (
        try .moveTab(
          SupatermMoveTabRequest(
            destination: .root(isPinned: true),
            index: 1,
            target: target
          ),
          id: "root-first"
        ),
        .root(isPinned: true, index: 0)
      ),
      (
        try .moveTab(
          SupatermMoveTabRequest(destination: .root(isPinned: false), target: target),
          id: "root-append"
        ),
        .root(isPinned: false, index: nil)
      ),
    ]
    let store = makeTabGroupStore(
      replyRecorder: replyRecorder,
      execute: { request in
        await recorder.record(request)
        return .movedTab(tabGroupTestMoveResult)
      }
    )

    for fixture in fixtures {
      await store.send(
        .requestReceived(SocketControlClient.Request(handle: UUID(), payload: fixture.0))
      )
    }

    let expectedTarget = TerminalTabTarget(tabID: tabGroupTestTabID)
    #expect(
      await recorder.snapshot()
        == fixtures.map {
          .moveTab(TerminalMoveTabRequest(destination: $0.1, target: expectedTarget))
        }
    )
    let replies = await replyRecorder.snapshot()
    #expect(replies.count == fixtures.count)
    for record in replies {
      #expect(try record.response.decodeResult(SupatermMoveTabResult.self) == tabGroupTestMoveResult)
    }
  }

  @Test
  func moveIndexesRejectZeroBeforeExecution() async throws {
    let recorder = TerminalTabGroupRequestRecorder()
    let replyRecorder = SocketReplyRecorder()
    let target = SupatermTabGroupTargetRequest(groupID: tabGroupTestGroupID)
    let store = makeTabGroupStore(
      replyRecorder: replyRecorder,
      execute: { request in
        await recorder.record(request)
        return .group(tabGroupTestMutationResult)
      }
    )

    await store.send(
      .requestReceived(
        SocketControlClient.Request(
          handle: UUID(),
          payload: try .moveTabGroup(
            SupatermMoveTabGroupRequest(index: 0, target: target),
            id: "invalid"
          )
        )
      )
    )

    #expect(await recorder.snapshot().isEmpty)
    let replies = await replyRecorder.snapshot()
    #expect(replies.count == 1)
    let response = try #require(replies.first?.response)
    #expect(response.error?.code == "invalid_request")
    #expect(response.error?.message == "index must be 1 or greater.")
  }
}

private let tabGroupTestGroupID = UUID(uuidString: "5A52445E-E42A-48B7-A5DD-C6C7C978B139")!
private let tabGroupTestSpaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
private let tabGroupTestTabID = UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!

private let tabGroupTestMutationResult = SupatermTabGroupMutationResult(
  group: SupatermTreeSnapshot.Group(
    color: .green,
    id: tabGroupTestGroupID,
    isCollapsed: false,
    isPinned: true,
    title: "Work",
    tabs: []
  ),
  windowIndex: 2,
  spaceIndex: 3,
  spaceID: tabGroupTestSpaceID
)

private let tabGroupTestRemovalResult = SupatermRemoveTabGroupResult(
  removedGroupID: tabGroupTestGroupID,
  spaceID: tabGroupTestSpaceID,
  spaceIndex: 3,
  windowIndex: 2
)

private let tabGroupTestMoveResult = SupatermMoveTabResult(
  target: SupatermTabTarget(
    windowIndex: 1,
    spaceIndex: 2,
    spaceID: tabGroupTestSpaceID,
    tabIndex: 1,
    tabID: tabGroupTestTabID,
    title: "Build"
  )
)

@MainActor
private func makeTabGroupStore(
  replyRecorder: SocketReplyRecorder,
  execute:
    @escaping @MainActor @Sendable (
      TerminalTabGroupRequest
    ) async throws -> TerminalTabGroupResult
) -> TestStoreOf<SocketControlFeature> {
  TestStore(initialState: SocketControlFeature.State()) {
    SocketControlFeature()
  } withDependencies: {
    $0.socketControlClient.reply = { handle, response in
      await replyRecorder.record(handle: handle, response: response)
    }
    $0.socketRequestExecutor = .testing(
      terminalWindowsClient: $0.terminalWindowsClient,
      executeTerminalTabGroup: execute
    )
  }
}

private actor TerminalTabGroupRequestRecorder {
  private var requests: [TerminalTabGroupRequest] = []

  func record(_ request: TerminalTabGroupRequest) {
    requests.append(request)
  }

  func snapshot() -> [TerminalTabGroupRequest] {
    requests
  }
}
