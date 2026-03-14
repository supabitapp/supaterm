import ComposableArchitecture
import Foundation
import SwiftUI

@Reducer
struct TerminalTabsFeature {
  @Dependency(\.uuid) var uuid

  @ObservableState
  struct State: Equatable {
    var tabs: IdentifiedArrayOf<Tab>
    var selectedTabID: Tab.ID

    init(
      tabs: IdentifiedArrayOf<Tab> = .initialTabs,
      selectedTabID: Tab.ID? = nil,
    ) {
      self.tabs = tabs
      self.selectedTabID = selectedTabID ?? tabs[0].id
    }

    var pinnedTabs: [Tab] {
      tabs.elements.filter(\.isPinned)
    }

    var regularTabs: [Tab] {
      tabs.elements.filter { !$0.isPinned }
    }

    var visibleTabs: [Tab] {
      pinnedTabs + regularTabs
    }

    var selectedTab: Tab {
      tabs[id: selectedTabID] ?? visibleTabs[0]
    }

    mutating func setVisibleTabs(_ visibleTabs: [Tab]) {
      tabs = IdentifiedArray(uniqueElements: visibleTabs)
      if tabs[id: selectedTabID] == nil, let firstTab = tabs.first {
        selectedTabID = firstTab.id
      }
    }

    mutating func setPinnedTabOrder(_ orderedIDs: [Tab.ID]) {
      let pinnedByID = Dictionary(uniqueKeysWithValues: pinnedTabs.map { ($0.id, $0) })
      let orderedPinnedTabs = orderedIDs.compactMap { pinnedByID[$0] }
      guard orderedPinnedTabs.count == pinnedTabs.count else { return }
      setVisibleTabs(orderedPinnedTabs + regularTabs)
    }

    mutating func setRegularTabOrder(_ orderedIDs: [Tab.ID]) {
      let regularByID = Dictionary(uniqueKeysWithValues: regularTabs.map { ($0.id, $0) })
      let orderedRegularTabs = orderedIDs.compactMap { regularByID[$0] }
      guard orderedRegularTabs.count == regularTabs.count else { return }
      setVisibleTabs(pinnedTabs + orderedRegularTabs)
    }

    mutating func moveTab(_ tabID: Tab.ID, toSection isPinned: Bool) {
      guard var tab = tabs[id: tabID] else { return }
      var pinnedTabs = pinnedTabs
      var regularTabs = regularTabs

      if tab.isPinned {
        pinnedTabs.removeAll { $0.id == tabID }
      } else {
        regularTabs.removeAll { $0.id == tabID }
      }

      tab.isPinned = isPinned

      if isPinned {
        pinnedTabs.append(tab)
      } else {
        regularTabs.append(tab)
      }

      setVisibleTabs(pinnedTabs + regularTabs)
    }

    mutating func appendNewRegularTab(_ tab: Tab) {
      setVisibleTabs(pinnedTabs + regularTabs + [tab])
      selectedTabID = tab.id
    }

    mutating func selectTab(moving delta: Int) {
      let visibleTabs = visibleTabs
      guard
        !visibleTabs.isEmpty,
        let currentIndex = visibleTabs.firstIndex(where: { $0.id == selectedTabID })
      else { return }

      let nextIndex = (currentIndex + delta + visibleTabs.count) % visibleTabs.count
      selectedTabID = visibleTabs[nextIndex].id
    }

    mutating func closeSelectedOrCreateReplacement(
      for tabID: Tab.ID,
      makeReplacement: () -> Tab,
    ) {
      let visibleTabs = visibleTabs
      guard let closingIndex = visibleTabs.firstIndex(where: { $0.id == tabID }) else { return }

      tabs.remove(id: tabID)

      if tabs.isEmpty {
        let newTab = makeReplacement()
        tabs.append(newTab)
        selectedTabID = newTab.id
        return
      }

      let nextVisibleTabs = self.visibleTabs
      let replacementIndex = min(closingIndex, nextVisibleTabs.count - 1)
      selectedTabID = nextVisibleTabs[replacementIndex].id
    }
  }

  @ObservableState
  struct Tab: Equatable, Identifiable {
    let id: UUID
    var title: String
    var symbol: String
    var isPinned: Bool

    var tone: TerminalTone {
      TerminalTone.allCases[abs(id.uuidString.hashValue) % TerminalTone.allCases.count]
    }

    static func makeNewTab(id: UUID) -> Self {
      Self(id: id, title: "New Tab", symbol: "terminal", isPinned: false)
    }
  }

  enum Action: Equatable {
    case closeButtonTapped(Tab.ID)
    case newTabButtonTapped
    case nextTabRequested
    case pinnedTabOrderChanged([Tab.ID])
    case pinToggled(Tab.ID)
    case pinSelectedTabToggled
    case previousTabRequested
    case regularTabOrderChanged([Tab.ID])
    case tabSelected(Tab.ID)
    case tabShortcutPressed(Int)
  }

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .closeButtonTapped(let tabID):
        state.closeSelectedOrCreateReplacement(for: tabID) {
          .makeNewTab(id: uuid())
        }
        return .none

      case .newTabButtonTapped:
        let newTab = Tab.makeNewTab(id: uuid())
        state.appendNewRegularTab(newTab)
        return .none

      case .nextTabRequested:
        state.selectTab(moving: 1)
        return .none

      case .pinnedTabOrderChanged(let orderedIDs):
        state.setPinnedTabOrder(orderedIDs)
        return .none

      case .pinToggled(let tabID):
        guard let tab = state.tabs[id: tabID] else { return .none }
        state.moveTab(tabID, toSection: !tab.isPinned)
        return .none

      case .pinSelectedTabToggled:
        guard let tab = state.tabs[id: state.selectedTabID] else { return .none }
        state.moveTab(tab.id, toSection: !tab.isPinned)
        return .none

      case .previousTabRequested:
        state.selectTab(moving: -1)
        return .none

      case .regularTabOrderChanged(let orderedIDs):
        state.setRegularTabOrder(orderedIDs)
        return .none

      case .tabSelected(let tabID):
        guard state.tabs[id: tabID] != nil else { return .none }
        state.selectedTabID = tabID
        return .none

      case .tabShortcutPressed(let slot):
        let index = slot - 1
        guard state.visibleTabs.indices.contains(index) else { return .none }
        state.selectedTabID = state.visibleTabs[index].id
        return .none
      }
    }
  }
}

extension IdentifiedArray where ID == TerminalTabsFeature.Tab.ID, Element == TerminalTabsFeature.Tab {
  static let initialTabs: Self = [
    .init(
      id: UUID(uuidString: "8E4D39F7-64F7-44BA-A30F-5B6F20A49501")!,
      title: "Command Deck",
      symbol: "command",
      isPinned: true,
    ),
    .init(
      id: UUID(uuidString: "8E4D39F7-64F7-44BA-A30F-5B6F20A49502")!,
      title: "Sessions",
      symbol: "terminal",
      isPinned: true,
    ),
    .init(
      id: UUID(uuidString: "8E4D39F7-64F7-44BA-A30F-5B6F20A49503")!,
      title: "Profiles",
      symbol: "slider.horizontal.3",
      isPinned: true,
    ),
    .init(
      id: UUID(uuidString: "8E4D39F7-64F7-44BA-A30F-5B6F20A49504")!,
      title: "Workspace Notes",
      symbol: "note.text",
      isPinned: false,
    ),
    .init(
      id: UUID(uuidString: "8E4D39F7-64F7-44BA-A30F-5B6F20A49505")!,
      title: "Build Output",
      symbol: "bolt",
      isPinned: false,
    ),
    .init(
      id: UUID(uuidString: "8E4D39F7-64F7-44BA-A30F-5B6F20A49506")!,
      title: "Window Styling",
      symbol: "macwindow",
      isPinned: false,
    ),
    .init(
      id: UUID(uuidString: "8E4D39F7-64F7-44BA-A30F-5B6F20A49507")!,
      title: "Search Results",
      symbol: "magnifyingglass",
      isPinned: false,
    ),
  ]
}

enum TerminalTone: CaseIterable, Equatable {
  case amber
  case coral
  case mint
  case sky
  case slate
  case violet
}
