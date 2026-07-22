import XCTest

enum SidebarRootExpectation: Equatable, CustomStringConvertible {
  case tab(String)
  case group(String, children: [String])

  var description: String {
    switch self {
    case .tab(let title):
      "tab(\(title))"
    case .group(let title, let children):
      "group(\(title): \(children.joined(separator: ", ")))"
    }
  }
}

extension SupatermUITestCase {
  @MainActor
  var sidebarTabRows: XCUIElementQuery {
    app.buttons.matching(
      NSPredicate(
        format: "identifier BEGINSWITH %@ OR (identifier BEGINSWITH %@ AND identifier CONTAINS %@)",
        SupatermUITestIdentifier.Accessibility.sidebarRootTabRowPrefix,
        SupatermUITestIdentifier.Accessibility.sidebarGroupPrefix,
        SupatermUITestIdentifier.Accessibility.sidebarGroupedTabMarker
      )
    )
  }

  @MainActor
  var sidebarSemanticTabRows: XCUIElementQuery {
    sidebarTabRows
  }

  @MainActor
  var sidebarStructuralRows: XCUIElementQuery {
    app.descendants(matching: .tableRow).matching(
      NSPredicate(
        format: "identifier BEGINSWITH %@",
        SupatermUITestIdentifier.Accessibility.sidebarStructuralRowPrefix
      )
    )
  }

  @MainActor
  var sidebarGroupHeaders: XCUIElementQuery {
    sidebarStructuralRows.matching(
      NSPredicate(
        format: "identifier BEGINSWITH %@",
        SupatermUITestIdentifier.Accessibility.sidebarGroupHeaderPrefix
      )
    )
  }

  @MainActor
  func sidebarTabRow(named title: String) -> XCUIElement {
    sidebarSemanticTabRows.matching(
      NSPredicate(format: "label CONTAINS %@", title)
    ).firstMatch
  }

  @MainActor
  func sidebarGroupHeader(named title: String) -> XCUIElement {
    app.buttons.matching(
      NSPredicate(
        format: "identifier BEGINSWITH %@ AND label CONTAINS %@",
        SupatermUITestIdentifier.Accessibility.sidebarGroupHeaderPrefix,
        title
      )
    ).firstMatch
  }

  @MainActor
  func sidebarStructuralTabRow(named title: String) -> XCUIElement {
    sidebarTabRow(named: title)
  }

  @MainActor
  func sidebarFooterRow(_ identifier: String) -> XCUIElement {
    sidebarStructuralRows.matching(identifier: identifier).firstMatch
  }

  @MainActor
  func createGroup(named title: String, containing tabTitle: String) async throws {
    try clickSidebarContextMenuItem("Move to New Group", on: sidebarTabRow(named: tabTitle))

    let titleField = try require(app.textFields["Group name"])
    titleField.click()
    titleField.typeKey("a", modifierFlags: .command)
    titleField.typeText(title)
    titleField.typeKey(.return, modifierFlags: [])

    let didCreateGroup = await wait {
      self.sidebarGroupHeader(named: title).exists
    }
    XCTAssertTrue(didCreateGroup)
  }

  @MainActor
  func renameSelectedTab(to title: String) async throws {
    try clickMenuItem(.changeTabTitle)

    let sheet = mainWindow.sheets.firstMatch
    XCTAssertTrue(sheet.waitForExistence(timeout: 10))
    XCTAssertTrue(sheet.staticTexts["Change Tab Title"].exists)

    let titleField = sheet.textFields.firstMatch
    XCTAssertTrue(titleField.waitForExistence(timeout: 10))
    titleField.click()
    titleField.typeKey("a", modifierFlags: .command)
    titleField.typeText(title)
    sheet.buttons["OK"].click()

    let didDismissSheet = await wait(for: sheet) { !$0.exists }
    XCTAssertTrue(didDismissSheet)
    let didUpdateTitle = await wait(for: sidebarTabRow(named: title)) { $0.exists }
    XCTAssertTrue(didUpdateTitle)
  }

  @MainActor
  func createNamedTabs(_ titles: [String]) async throws {
    precondition(!titles.isEmpty)
    _ = mainWindow
    let didShowInitialTab = await waitForSidebarElementCount(
      sidebarTabRows,
      equals: 1,
      timeout: .seconds(30)
    )
    XCTAssertTrue(didShowInitialTab)

    for (index, title) in titles.enumerated() {
      if index > 0 {
        try clickMenuItem(.newTab)
        let didCreateTab = await waitForSidebarElementCount(
          sidebarTabRows,
          equals: index + 1,
          timeout: .seconds(30)
        )
        XCTAssertTrue(didCreateTab)
      }
      try await renameSelectedTab(to: title)
    }
  }

  @MainActor
  func clickSidebarContextMenuItem(
    _ title: String,
    on element: XCUIElement,
    timeout: TimeInterval = 10
  ) throws {
    let foundElement = try require(element, timeout: timeout)
    foundElement.rightClick()

    let itemCandidate = app.menuItems[title].firstMatch
    let item = try require(itemCandidate, timeout: timeout)
    item.click()
  }

  @MainActor
  func drag(
    _ source: XCUIElement,
    to destination: XCUIElement,
    destinationOffset: CGVector = CGVector(dx: 0.5, dy: 0.5)
  ) throws {
    let source = try require(source)
    let destination = try require(destination)
    source.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
      forDuration: 0.5,
      thenDragTo: destination.coordinate(withNormalizedOffset: destinationOffset),
      withVelocity: .slow,
      thenHoldForDuration: 0
    )
  }

  @MainActor
  func drag(_ source: XCUIElement, to destination: XCUICoordinate) throws {
    let source = try require(source)
    source.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).press(
      forDuration: 0.5,
      thenDragTo: destination,
      withVelocity: .slow,
      thenHoldForDuration: 0
    )
  }

  @MainActor
  func waitForSidebarElementCount(
    _ query: XCUIElementQuery,
    equals expectedCount: Int,
    timeout: Duration = .seconds(10)
  ) async -> Bool {
    await wait(timeout: timeout) {
      query.count == expectedCount
    }
  }

  @MainActor
  func waitForSidebarSelection(_ element: XCUIElement) async -> Bool {
    await wait(for: element) { $0.isSelected }
  }

  @MainActor
  func waitForTabOrder(
    _ titles: [String],
    timeout: Duration = .seconds(10)
  ) async -> Bool {
    precondition(!titles.isEmpty)
    return await wait(
      for: sidebarTabRows.element(boundBy: titles.count - 1),
      timeout: timeout
    ) { _ in
      guard self.sidebarTabRows.count == titles.count else { return false }
      return titles.indices.allSatisfy {
        self.sidebarTabRows.element(boundBy: $0).label.contains(titles[$0])
      }
    }
  }

  @MainActor
  func waitForSidebarStructure(
    _ expected: [SidebarRootExpectation],
    timeout: Duration = .seconds(15)
  ) async -> Bool {
    await wait(timeout: timeout) {
      self.sidebarMatches(expected)
    }
  }

  @MainActor
  func sidebarStructureDescription() -> String {
    sidebarStructuralRows.allElementsBoundByIndex.map {
      "\($0.identifier)=\(sidebarSemanticControl(for: $0).label)"
    }.joined(separator: " | ")
  }

  @MainActor
  private func sidebarMatches(_ expected: [SidebarRootExpectation]) -> Bool {
    let rows = sidebarStructuralRows.allElementsBoundByIndex
    let roots = rows.filter { row in
      row.identifier.hasPrefix(
        SupatermUITestIdentifier.Accessibility.sidebarRootTabRowPrefix
      )
        || row.identifier.hasPrefix(
          SupatermUITestIdentifier.Accessibility.sidebarGroupHeaderPrefix
        )
    }
    guard roots.count == expected.count else { return false }

    for (row, expectation) in zip(roots, expected) {
      switch expectation {
      case .tab(let title):
        let control = sidebarSemanticControl(for: row)
        guard
          row.identifier.hasPrefix(
            SupatermUITestIdentifier.Accessibility.sidebarRootTabRowPrefix
          ),
          control.exists,
          control.label.contains(title)
        else { return false }
      case .group(let title, let expectedChildren):
        let prefix = SupatermUITestIdentifier.Accessibility.sidebarGroupHeaderPrefix
        guard row.identifier.hasPrefix(prefix) else { return false }
        let header = sidebarSemanticControl(for: row)
        guard header.exists, header.label.contains(title) else { return false }
        let groupID = String(row.identifier.dropFirst(prefix.count))
        let childPrefix =
          SupatermUITestIdentifier.Accessibility.sidebarGroupPrefix
          + groupID
          + SupatermUITestIdentifier.Accessibility.sidebarGroupedTabMarker
        let children = rows.filter { $0.identifier.hasPrefix(childPrefix) }
        guard children.count == expectedChildren.count else { return false }
        guard
          zip(children, expectedChildren).allSatisfy({ pair in
            let control = sidebarSemanticControl(for: pair.0)
            return control.exists && control.label.contains(pair.1)
          })
        else { return false }
      }
    }
    return true
  }

  @MainActor
  private func sidebarSemanticControl(for row: XCUIElement) -> XCUIElement {
    app.buttons.matching(identifier: row.identifier).firstMatch
  }
}
