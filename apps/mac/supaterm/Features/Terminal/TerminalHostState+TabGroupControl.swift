import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalHostState {
  struct ResolvedGroupClose {
    let result: SupatermRemoveTabGroupResult
    let shouldCloseWindow: Bool
  }

  func executeTabGroup(_ request: TerminalTabGroupRequest) throws -> TerminalTabGroupResult {
    switch request {
    case .close(let groupID):
      let resolved = try resolvedControlGroup(groupID)
      let result = removedGroupResult(resolved)
      performCloseGroup(resolved.group.id)
      return .removedGroup(result)

    case .create(let request):
      let target = try resolveSpaceTarget(request.target)
      guard let manager = spaceManager.tabManager(for: target.space.id) else {
        throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: 1)
      }
      guard
        let creation = manager.createGroup(
          title: request.title,
          color: TerminalTabGroupColor(socketColor: request.color),
          containing: []
        )
      else {
        throw TerminalControlError.invalidGroupTitle
      }
      let groupID = creation.groupID
      if request.isPinned {
        _ = manager.setPinned(.group(groupID), isPinned: true)
      }
      sessionDidChange()
      return .group(try groupMutationResult(for: groupID))

    case .move(let request):
      let resolved = try resolvedControlGroup(request.groupID)
      let topologyRevision = try controlTopologyRevision(
        in: resolved.space.id,
        groupID: request.groupID
      )
      let placement = TerminalRootPlacement(
        isPinned: resolved.group.isPinned,
        index: request.index
      )
      guard
        (try? move(
          TerminalTabMoveRequest(
            expectedTopologyRevision: topologyRevision,
            itemIDs: [.group(resolved.group.id)],
            destination: .root(placement)
          )
        )) != nil
      else {
        throw TerminalControlError.invalidGroupIndex(request.index)
      }
      return .group(try groupMutationResult(for: resolved.group.id))

    case .moveTab(let request):
      return .movedTab(try moveTabForControl(request))

    case .pin(let groupID):
      let resolved = try resolvedControlGroup(groupID)
      _ = setPinned(.group(resolved.group.id), isPinned: true)
      return .group(try groupMutationResult(for: resolved.group.id))

    case .rename(let request):
      let resolved = try resolvedControlGroup(request.groupID)
      guard renameGroup(resolved.group.id, title: request.title) else {
        throw TerminalControlError.invalidGroupTitle
      }
      return .group(try groupMutationResult(for: resolved.group.id))

    case .setCollapsed(let request):
      let resolved = try resolvedControlGroup(request.groupID)
      _ = setGroupCollapsed(resolved.group.id, isCollapsed: request.isCollapsed)
      return .group(try groupMutationResult(for: resolved.group.id))

    case .setColor(let request):
      let resolved = try resolvedControlGroup(request.groupID)
      _ = setGroupColor(
        resolved.group.id,
        color: TerminalTabGroupColor(socketColor: request.color)
      )
      return .group(try groupMutationResult(for: resolved.group.id))

    case .ungroup(let groupID):
      let resolved = try resolvedControlGroup(groupID)
      let result = removedGroupResult(resolved)
      _ = ungroup(resolved.group.id)
      return .removedGroup(result)

    case .unpin(let groupID):
      let resolved = try resolvedControlGroup(groupID)
      _ = setPinned(.group(resolved.group.id), isPinned: false)
      return .group(try groupMutationResult(for: resolved.group.id))
    }
  }

  func resolveGroupClose(_ rawGroupID: UUID) throws -> ResolvedGroupClose {
    let resolved = try resolvedControlGroup(rawGroupID)
    let closeRequest = resolvedCloseRequest(
      for: .group(resolved.group.id),
      needsConfirmationOverride: false
    )
    return ResolvedGroupClose(
      result: removedGroupResult(resolved),
      shouldCloseWindow: closeRequest?.closesWindow == true
    )
  }

  private struct ResolvedControlGroup {
    let group: TerminalTabGroupItem
    let space: TerminalSpaceItem
    let spaceIndex: Int
  }

  private func resolvedControlGroup(_ rawGroupID: UUID) throws -> ResolvedControlGroup {
    let groupID = TerminalTabGroupID(rawValue: rawGroupID)
    guard
      let space = spaceManager.space(for: groupID),
      let group = spaceManager.tabManager(for: space.id)?.group(for: groupID),
      let spaceIndex = spaceManager.spaceIndex(for: space.id)
    else {
      throw TerminalControlError.groupNotFound(rawGroupID)
    }
    return ResolvedControlGroup(group: group, space: space, spaceIndex: spaceIndex)
  }

  private func controlTopologyRevision(
    in spaceID: TerminalSpaceID,
    groupID: UUID
  ) throws -> UInt64 {
    guard let manager = spaceManager.tabManager(for: spaceID) else {
      throw TerminalControlError.groupNotFound(groupID)
    }
    return manager.topologyRevision
  }

  private func groupMutationResult(
    for groupID: TerminalTabGroupID
  ) throws -> SupatermTabGroupMutationResult {
    let resolved = try resolvedControlGroup(groupID.rawValue)
    return SupatermTabGroupMutationResult(
      group: treeGroupSnapshot(resolved.group, spaceID: resolved.space.id),
      windowIndex: 1,
      spaceIndex: resolved.spaceIndex,
      spaceID: resolved.space.id.rawValue
    )
  }

  private func removedGroupResult(
    _ resolved: ResolvedControlGroup
  ) -> SupatermRemoveTabGroupResult {
    SupatermRemoveTabGroupResult(
      removedGroupID: resolved.group.id.rawValue,
      spaceID: resolved.space.id.rawValue,
      spaceIndex: resolved.spaceIndex,
      windowIndex: 1
    )
  }

  private func moveTabForControl(
    _ request: TerminalMoveTabRequest
  ) throws -> SupatermMoveTabResult {
    let target = try resolveTabItemTarget(request.target)
    guard let manager = spaceManager.tabManager(for: target.spaceID) else {
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: 1)
    }

    let placement: TerminalTabPlacement
    switch request.destination {
    case .group(let rawGroupID, let requestedIndex):
      let groupID = TerminalTabGroupID(rawValue: rawGroupID)
      guard let group = manager.group(for: groupID) else {
        if spaceManager.space(for: groupID) == nil {
          throw TerminalControlError.groupNotFound(rawGroupID)
        }
        throw TerminalControlError.groupSpaceMismatch
      }
      let sourceIsInDestination = manager.groupID(containing: target.tabID) == groupID
      let destinationCount = group.tabs.count - (sourceIsInDestination ? 1 : 0)
      placement = .group(groupID, index: requestedIndex ?? destinationCount)

    case .root(let isPinned, let requestedIndex):
      let destinationCount =
        manager.rootCount(
          isPinned: isPinned,
          afterRemoving: [.tab(target.tabID)]
        ) ?? 0
      placement = .root(
        TerminalRootPlacement(isPinned: isPinned, index: requestedIndex ?? destinationCount)
      )
    }

    guard
      (try? move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: manager.topologyRevision,
          itemIDs: [.tab(target.tabID)],
          destination: placement
        )
      )) != nil
    else {
      let index: Int
      switch placement {
      case .group(_, let destinationIndex):
        index = destinationIndex
      case .root(let destination):
        index = destination.index
      }
      throw TerminalControlError.invalidGroupIndex(index)
    }
    return SupatermMoveTabResult(target: try tabTarget(for: target.tabID))
  }

}
