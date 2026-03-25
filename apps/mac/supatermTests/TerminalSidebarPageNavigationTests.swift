import Testing

@testable import supaterm

struct TerminalSidebarPageNavigationTests {
  @Test
  func resolvedSelectionPrefersPreferredValueWhenPresent() {
    let first = TerminalSpaceID()
    let second = TerminalSpaceID()

    #expect(
      TerminalSidebarPageNavigation.resolvedSelection(
        preferred: second,
        orderedValues: [first, second]
      ) == second
    )
  }

  @Test
  func resolvedSelectionFallsBackToFirstOrderedValue() {
    let first = TerminalSpaceID()
    let second = TerminalSpaceID()

    #expect(
      TerminalSidebarPageNavigation.resolvedSelection(
        preferred: TerminalSpaceID(),
        orderedValues: [first, second]
      ) == first
    )
  }

  @Test
  func nextReturnsFollowingValue() {
    let first = TerminalSpaceID()
    let second = TerminalSpaceID()
    let third = TerminalSpaceID()

    #expect(
      TerminalSidebarPageNavigation.next(
        after: second,
        in: [first, second, third]
      ) == third
    )
  }

  @Test
  func nextReturnsNilAtEnd() {
    let first = TerminalSpaceID()
    let second = TerminalSpaceID()

    #expect(
      TerminalSidebarPageNavigation.next(
        after: second,
        in: [first, second]
      ) == nil
    )
  }

  @Test
  func previousReturnsPriorValue() {
    let first = TerminalSpaceID()
    let second = TerminalSpaceID()
    let third = TerminalSpaceID()

    #expect(
      TerminalSidebarPageNavigation.previous(
        before: second,
        in: [first, second, third]
      ) == first
    )
  }

  @Test
  func previousReturnsNilAtBeginning() {
    let first = TerminalSpaceID()
    let second = TerminalSpaceID()

    #expect(
      TerminalSidebarPageNavigation.previous(
        before: first,
        in: [first, second]
      ) == nil
    )
  }
}
