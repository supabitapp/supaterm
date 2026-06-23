import Foundation
import GhosttyKit
import SupatermCLIShared
import SupatermGhosttyFeature
import SupatermTerminalCore
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SupatermTerminalStateFeature

extension TerminalHostState {
  public func createPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
    let resolvedTarget = try resolveCreatePaneTarget(request.target)
    let newSurface = createSurface(
      tabID: resolvedTarget.tabID,
      startupCommand: request.startupCommand,
      inheritingFromSurfaceID: resolvedTarget.anchorSurface.id,
      workingDirectory: request.cwd.map { URL(fileURLWithPath: $0, isDirectory: true) },
      context: GHOSTTY_SURFACE_CONTEXT_SPLIT
    )

    do {
      let newTree = try resolvedTarget.tree.inserting(
        view: newSurface,
        at: resolvedTarget.anchorSurface,
        direction: mapPaneDirection(request.direction)
      )
      let finalTree = request.equalize ? newTree.equalized() : newTree
      trees[resolvedTarget.tabID] = finalTree
      updateRunningState(for: resolvedTarget.tabID)

      let nextSelectedTabID = Self.selectedTabID(
        afterCreatingPaneIn: resolvedTarget.tabID,
        focusRequested: request.focus,
        currentSelectedTabID: spaceManager.selectedTabID
      )
      if let nextSelectedTabID, nextSelectedTabID != spaceManager.selectedTabID {
        if let space = spaceManager.space(for: nextSelectedTabID) {
          _ = applySelectedSpace(space.id)
          applySelectedTab(nextSelectedTabID, in: space.id)
        }
      }

      if request.focus {
        focusSurface(newSurface, in: resolvedTarget.tabID)
      }

      syncFocus(windowActivity)
      sessionDidChange()

      let paneLocation = try resolvedPaneLocation(
        spaceID: resolvedTarget.spaceID,
        tabID: resolvedTarget.tabID,
        surfaceID: newSurface.id,
        tree: finalTree
      )
      let selectionState = Self.newPaneSelectionState(
        selectedTabID: spaceManager.selectedTabID,
        targetTabID: resolvedTarget.tabID,
        windowActivity: windowActivity,
        focusedSurfaceID: focusHistoryByTab[resolvedTarget.tabID]?.current,
        surfaceID: newSurface.id
      )

      return SupatermNewPaneResult(
        direction: request.direction,
        isFocused: selectionState.isFocused,
        isSelectedTab: selectionState.isSelectedTab,
        windowIndex: 1,
        spaceIndex: paneLocation.spaceIndex,
        spaceID: resolvedTarget.spaceID.rawValue,
        tabIndex: paneLocation.tabIndex,
        tabID: resolvedTarget.tabID.rawValue,
        paneIndex: paneLocation.paneIndex,
        paneID: newSurface.id
      )
    } catch let error as TerminalCreatePaneError {
      killZmxSession(for: newSurface.id)
      newSurface.closeSurface()
      surfaces.removeValue(forKey: newSurface.id)
      throw error
    } catch {
      killZmxSession(for: newSurface.id)
      newSurface.closeSurface()
      surfaces.removeValue(forKey: newSurface.id)
      throw TerminalCreatePaneError.creationFailed
    }
  }

  public func createTab(_ request: TerminalCreateTabRequest) throws -> SupatermNewTabResult {
    let resolvedTarget = try resolveCreateTabTarget(request.target)
    let currentSelectedSpaceID = spaceManager.selectedSpaceID
    let currentSelectedTabID = spaceManager.selectedTabID
    var createdTabID: TerminalTabID?

    do {
      let tabID =
        createTab(
          in: resolvedTarget.space.id,
          focusing: false,
          startupCommand: request.startupCommand,
          workingDirectory: request.cwd.map { URL(fileURLWithPath: $0, isDirectory: true) },
          inheritingFromSurfaceID: resolvedTarget.inheritedSurfaceID,
          sessionChangesEnabled: false,
          synchronizesFocus: Self.shouldSyncFocusDuringTabCreation(
            targetSpaceID: resolvedTarget.space.id,
            focusRequested: request.focus,
            currentSelectedSpaceID: currentSelectedSpaceID
          )
        )
      guard
        let tabID,
        let tree = trees[tabID],
        let surfaceID = tree.root?.leftmostLeaf().id
      else {
        throw TerminalCreateTabError.creationFailed
      }
      createdTabID = tabID

      let resolvedSelectedTabID = Self.selectedTabID(
        afterCreatingTabIn: resolvedTarget.space.id,
        targetTabID: tabID,
        focusRequested: request.focus,
        currentSelectedSpaceID: currentSelectedSpaceID,
        currentSelectedTabID: currentSelectedTabID
      )
      if let tabManager = spaceManager.tabManager(for: resolvedTarget.space.id),
        resolvedSelectedTabID != tabManager.selectedTabId
      {
        applySelectedTab(resolvedSelectedTabID, in: resolvedTarget.space.id)
      }

      if request.focus {
        if currentSelectedSpaceID != resolvedTarget.space.id {
          selectSpace(resolvedTarget.space.id, persistDefaultSelection: true)
        }
        applySelectedTab(tabID, in: resolvedTarget.space.id)
        if let surface = surfaces[surfaceID] {
          focusSurface(surface, in: tabID)
        }
      }

      syncFocus(windowActivity)
      sessionDidChange()

      guard
        let spaceIndex = spaceManager.spaceIndex(for: resolvedTarget.space.id),
        let tabIndex = spaceManager.tabs(in: resolvedTarget.space.id)
          .firstIndex(where: { $0.id == tabID }),
        let paneIndex = tree.leaves().firstIndex(where: { $0.id == surfaceID })
      else {
        throw TerminalCreateTabError.creationFailed
      }

      let selectionState = Self.newTabSelectionState(
        NewTabSelectionInput(
          selectedSpaceID: spaceManager.selectedSpaceID,
          targetSpaceID: resolvedTarget.space.id,
          selectedTabID: spaceManager.selectedTabID,
          targetTabID: tabID,
          windowActivity: windowActivity,
          focusedSurfaceID: focusHistoryByTab[tabID]?.current,
          surfaceID: surfaceID
        )
      )

      return SupatermNewTabResult(
        isFocused: selectionState.isFocused,
        isSelectedSpace: selectionState.isSelectedSpace,
        isSelectedTab: selectionState.isSelectedTab,
        windowIndex: 1,
        spaceIndex: spaceIndex,
        spaceID: resolvedTarget.space.id.rawValue,
        tabIndex: tabIndex + 1,
        tabID: tabID.rawValue,
        paneIndex: paneIndex + 1,
        paneID: surfaceID
      )
    } catch let error as TerminalCreateTabError {
      if let createdTabID {
        removeTree(for: createdTabID, source: .controlCleanup)
        spaceManager.tabManager(for: resolvedTarget.space.id)?.closeTab(createdTabID)
      }
      throw error
    } catch {
      if let createdTabID {
        removeTree(for: createdTabID, source: .controlCleanup)
        spaceManager.tabManager(for: resolvedTarget.space.id)?.closeTab(createdTabID)
      }
      throw TerminalCreateTabError.creationFailed
    }
  }
}
