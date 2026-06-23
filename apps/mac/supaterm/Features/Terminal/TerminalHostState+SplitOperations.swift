import CoreGraphics
import Foundation
import GhosttyKit
import SupatermGhosttyFeature
import SupatermTerminalModels
import SupatermTerminalPresentationFeature

extension TerminalHostState {
  func performSplitAction(_ action: GhosttySplitAction, for surfaceID: UUID) -> Bool {
    guard let tabID = tabID(containing: surfaceID), var tree = trees[tabID] else {
      return false
    }
    guard let targetNode = tree.find(id: surfaceID) else { return false }
    guard let targetSurface = surfaces[surfaceID] else { return false }

    switch action {
    case .newSplit(let direction):
      let newSurface = createSurface(
        tabID: tabID,
        startupCommand: nil,
        inheritingFromSurfaceID: surfaceID,
        context: GHOSTTY_SURFACE_CONTEXT_SPLIT
      )
      do {
        let newTree = try tree.inserting(
          view: newSurface,
          at: targetSurface,
          direction: mapSplitDirection(direction)
        )
        trees[tabID] = newTree
        focusSurface(newSurface, in: tabID)
        sessionDidChange()
        return true
      } catch {
        killZmxSession(for: newSurface.id)
        newSurface.closeSurface()
        surfaces.removeValue(forKey: newSurface.id)
        return false
      }

    case .gotoSplit(let direction):
      let focusDirection = mapFocusDirection(direction)
      guard let nextSurface = tree.focusTarget(for: focusDirection, from: targetNode) else {
        return false
      }
      if tree.zoomed != nil {
        let newZoomed =
          runtime?.splitPreserveZoomOnNavigation() == true
          ? tree.root?.node(view: nextSurface)
          : nil
        tree = tree.settingZoomed(newZoomed)
        trees[tabID] = tree
      }
      focusSurface(nextSurface, in: tabID)
      sessionDidChange()
      return true

    case .resizeSplit(let direction, let amount):
      let spatialDirection = mapResizeDirection(direction)
      do {
        let newTree = try tree.resizing(
          node: targetNode,
          by: amount,
          in: spatialDirection,
          with: CGRect(origin: .zero, size: tree.viewBounds())
        )
        trees[tabID] = newTree
        sessionDidChange()
        return true
      } catch {
        return false
      }

    case .equalizeSplits:
      trees[tabID] = tree.equalized()
      sessionDidChange()
      return true

    case .toggleSplitZoom:
      guard tree.isSplit else { return false }
      let newZoomed = tree.zoomed == targetNode ? nil : targetNode
      trees[tabID] = tree.settingZoomed(newZoomed)
      focusSurface(targetSurface, in: tabID)
      return true
    }
  }

  func performSplitOperation(
    _ operation: TerminalWindowSplitOperation, in tabID: TerminalTabID
  ) {
    guard var tree = trees[tabID] else { return }

    switch operation {
    case .resize(let leafIDs, let ratio):
      guard let node = splitNode(in: tree.root, matchingLeafIDs: leafIDs) else { return }
      let resizedNode = node.resizing(to: ratio)
      do {
        tree = try tree.replacing(node: node, with: resizedNode)
        trees[tabID] = tree
        sessionDidChange()
      } catch {
        return
      }

    case .drop(let payloadID, let destinationID, let zone):
      guard let payload = surfaces[payloadID] else { return }
      guard let destination = surfaces[destinationID] else { return }
      if payload === destination { return }
      guard let sourceNode = tree.root?.node(view: payload) else { return }
      let treeWithoutSource = tree.removing(sourceNode)
      if treeWithoutSource.isEmpty { return }
      do {
        let newTree = try treeWithoutSource.inserting(
          view: payload,
          at: destination,
          direction: mapDropZone(zone)
        )
        trees[tabID] = newTree
        focusSurface(payload, in: tabID)
        sessionDidChange()
      } catch {
        return
      }

    case .equalize:
      trees[tabID] = tree.equalized()
      sessionDidChange()
    }
  }

  private func splitNode(
    in node: SplitTree<GhosttySurfaceView>.Node?,
    matchingLeafIDs leafIDs: [UUID]
  ) -> SplitTree<GhosttySurfaceView>.Node? {
    guard let node else { return nil }
    switch node {
    case .leaf:
      return nil
    case .split(let split):
      if node.leaves().map(\.id) == leafIDs {
        return node
      }
      return splitNode(in: split.left, matchingLeafIDs: leafIDs)
        ?? splitNode(in: split.right, matchingLeafIDs: leafIDs)
    }
  }
}
