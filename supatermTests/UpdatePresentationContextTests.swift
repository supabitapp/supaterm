import Testing

@testable import supaterm

struct UpdatePresentationContextTests {
  @Test
  func expandedSidebarAllowsInlinePresentation() {
    let context = UpdatePresentationContext(
      isFloatingSidebarVisible: false,
      isSidebarCollapsed: false
    )

    #expect(context.allowsInlinePresentation(hasVisibleWindow: true))
  }

  @Test
  func floatingSidebarAllowsInlinePresentation() {
    let context = UpdatePresentationContext(
      isFloatingSidebarVisible: true,
      isSidebarCollapsed: true
    )

    #expect(context.allowsInlinePresentation(hasVisibleWindow: true))
  }

  @Test
  func hiddenSidebarDisablesInlinePresentation() {
    let context = UpdatePresentationContext(
      isFloatingSidebarVisible: false,
      isSidebarCollapsed: true
    )

    #expect(!context.allowsInlinePresentation(hasVisibleWindow: true))
  }

  @Test
  func invisibleWindowDisablesInlinePresentation() {
    let context = UpdatePresentationContext(
      isFloatingSidebarVisible: true,
      isSidebarCollapsed: false
    )

    #expect(!context.allowsInlinePresentation(hasVisibleWindow: false))
  }
}
