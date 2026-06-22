extension TerminalHostState {
  func handleCommand(_ command: TerminalClient.Command) {
    switch command {
    case .closeSurface,
      .closeTab,
      .closeTabs,
      .requestCloseSurface,
      .requestCloseTab,
      .requestCloseTabsBelow,
      .requestCloseOtherTabs:
      handleCloseCommand(command)
    case .createTab,
      .ensureInitialTab,
      .createSpace:
      handleCreationCommand(command)
    case .navigateSearch,
      .nextTab,
      .performGhosttyBindingActionOnFocusedSurface,
      .performBindingActionOnFocusedSurface,
      .performSplitOperation,
      .previousTab,
      .renameSpace:
      handleInteractionCommand(command)
    case .nextSpace,
      .previousSpace,
      .selectLastTab,
      .moveSidebarTab,
      .selectTab,
      .selectTabSlot,
      .selectSpaceSlot,
      .selectSpace,
      .setPinnedTabOrder,
      .setRegularTabOrder,
      .togglePinned,
      .updateWindowActivity,
      .deleteSpace:
      handleSelectionCommand(command)
    }
  }

  func handleCloseCommand(_ command: TerminalClient.Command) {
    switch command {
    case .closeSurface(let surfaceID):
      closeSurface(surfaceID)
    case .closeTab(let tabID):
      closeTab(tabID)
    case .closeTabs(let tabIDs):
      closeTabs(tabIDs)
    case .requestCloseSurface(let surfaceID):
      requestCloseSurface(surfaceID)
    case .requestCloseTab(let tabID):
      requestCloseTab(tabID)
    case .requestCloseTabsBelow(let tabID):
      requestCloseTabsBelow(tabID)
    case .requestCloseOtherTabs(let tabID):
      requestCloseOtherTabs(tabID)
    default:
      return
    }
  }

  func handleCreationCommand(_ command: TerminalClient.Command) {
    switch command {
    case .createTab(let inheritingFromSurfaceID):
      _ = createTab(inheritingFromSurfaceID: inheritingFromSurfaceID)
    case .ensureInitialTab(let focusing, let startupCommand, let workingDirectoryPath):
      ensureInitialTab(
        focusing: focusing,
        startupCommand: startupCommand,
        workingDirectoryPath: workingDirectoryPath
      )
    case .createSpace(let name):
      _ = try? createSpace(named: name)
    default:
      return
    }
  }

  func handleInteractionCommand(_ command: TerminalClient.Command) {
    switch command {
    case .navigateSearch(let direction):
      _ = navigateSearchOnFocusedSurface(direction)
    case .nextTab:
      nextTab()
    case .performGhosttyBindingActionOnFocusedSurface(let action):
      _ = performGhosttyBindingActionOnFocusedSurface(action)
    case .performBindingActionOnFocusedSurface(let command):
      _ = performBindingActionOnFocusedSurface(command)
    case .performSplitOperation(let tabID, let operation):
      performSplitOperation(operation, in: tabID)
    case .previousTab:
      previousTab()
    case .renameSpace(let spaceID, let name):
      renameSpace(spaceID, to: name)
    default:
      return
    }
  }

  func handleSelectionCommand(_ command: TerminalClient.Command) {
    switch command {
    case .selectLastTab:
      selectLastTab()
    case .nextSpace:
      nextSpace()
    case .selectTab(let tabID):
      selectTab(tabID)
    case .selectTabSlot(let slot):
      selectTab(slot: slot)
    case .selectSpaceSlot(let slot):
      selectSpace(slot: slot)
    case .selectSpace(let spaceID):
      selectSpace(spaceID)
    case .moveSidebarTab(let tabID, let pinnedOrder, let regularOrder):
      moveSidebarTab(tabID, pinnedOrder: pinnedOrder, regularOrder: regularOrder)
    case .setPinnedTabOrder(let orderedIDs):
      setPinnedTabOrder(orderedIDs)
    case .previousSpace:
      previousSpace()
    case .setRegularTabOrder(let orderedIDs):
      setRegularTabOrder(orderedIDs)
    case .togglePinned(let tabID):
      togglePinned(tabID)
    case .deleteSpace(let spaceID):
      deleteSpace(spaceID)
    case .updateWindowActivity(let activity):
      updateWindowActivity(activity)
    default:
      return
    }
  }
}
