import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermCLIShared
import SupatermTerminalModels
import SwiftUI

extension TerminalHostState {
  func mapGotoTabTarget(_ target: ghostty_action_goto_tab_e) -> TerminalGotoTabTarget? {
    let raw = Int(target.rawValue)
    if raw <= 0 {
      switch raw {
      case Int(GHOSTTY_GOTO_TAB_PREVIOUS.rawValue):
        return .previous
      case Int(GHOSTTY_GOTO_TAB_NEXT.rawValue):
        return .next
      case Int(GHOSTTY_GOTO_TAB_LAST.rawValue):
        return .last
      default:
        return nil
      }
    }
    return .index(raw)
  }

  func mapSplitDirection(_ direction: GhosttySplitAction.NewDirection)
    -> SplitTree<GhosttySurfaceView>.NewDirection
  {
    switch direction {
    case .left:
      return .left
    case .right:
      return .right
    case .up:
      return .up
    case .down:
      return .down
    }
  }

  func mapSplitDirection(_ direction: TerminalPaneSplitDirection)
    -> SplitTree<GhosttySurfaceView>.Direction
  {
    switch direction {
    case .horizontal:
      return .horizontal
    case .vertical:
      return .vertical
    }
  }

  func mapSessionSplitDirection(
    _ direction: SplitTree<GhosttySurfaceView>.Direction
  ) -> TerminalPaneSplitDirection {
    switch direction {
    case .horizontal:
      return .horizontal
    case .vertical:
      return .vertical
    }
  }

  func mapPaneDirection(_ direction: SupatermPaneDirection)
    -> SplitTree<GhosttySurfaceView>.NewDirection
  {
    switch direction {
    case .down:
      return .down
    case .left:
      return .left
    case .right:
      return .right
    case .up:
      return .up
    }
  }

  func mapFocusDirection(_ direction: GhosttySplitAction.FocusDirection)
    -> SplitTree<GhosttySurfaceView>.FocusDirection
  {
    switch direction {
    case .previous:
      return .previous
    case .next:
      return .next
    case .left:
      return .spatial(.left)
    case .right:
      return .spatial(.right)
    case .up:
      return .spatial(.up)
    case .down:
      return .spatial(.down)
    }
  }

  func mapResizeDirection(_ direction: GhosttySplitAction.ResizeDirection)
    -> SplitTree<GhosttySurfaceView>.SpatialDirection
  {
    switch direction {
    case .left:
      return .left
    case .right:
      return .right
    case .up:
      return .up
    case .down:
      return .down
    }
  }

  func mapResizeDirection(_ direction: SupatermResizePaneDirection)
    -> SplitTree<GhosttySurfaceView>.SpatialDirection
  {
    switch direction {
    case .left:
      return .left
    case .right:
      return .right
    case .up:
      return .up
    case .down:
      return .down
    }
  }

  func mapPaneAxis(_ axis: SupatermPaneAxis)
    -> SplitTree<GhosttySurfaceView>.Direction
  {
    switch axis {
    case .horizontal:
      return .horizontal
    case .vertical:
      return .vertical
    }
  }

  func mapPaneSizeUnit(_ unit: SupatermPaneSizeUnit)
    -> SplitTree<GhosttySurfaceView>.SizeUnit
  {
    switch unit {
    case .cells:
      return .cells
    case .percent:
      return .percent
    }
  }

  func mapDropZone(_ zone: TerminalSplitDropZone)
    -> SplitTree<GhosttySurfaceView>.NewDirection
  {
    switch zone {
    case .up:
      return .up
    case .bottom:
      return .down
    case .left:
      return .left
    case .right:
      return .right
    }
  }
}
