import Foundation
import SupatermCLIShared
import Testing

@testable import SupatermComputerUseFeature

struct ComputerUsePageRuntimeTests {
  @Test
  func queryDOMJavaScriptEscapesSelectorAndAttributes() throws {
    let javascript = try ComputerUsePageRuntime.queryDOMJavaScript(
      selector: #"a[href*="x"]"#,
      attributes: ["href", #"data-"quoted""#]
    )

    #expect(javascript.contains(#"document.querySelectorAll("a[href*=\"x\"]")"#))
    #expect(javascript.contains(#""data-\"quoted\"""#))
  }

  @Test
  func jsonValueDecodesStructuredResults() {
    let value = ComputerUsePageRuntime.jsonValue(
      fromJSONString: #"[{"tag":"a","text":"Docs","href":"https://example.com"}]"#
    )

    #expect(value?.arrayValue?.count == 1)
    #expect(value?.arrayValue?.first?.objectValue?["tag"]?.stringValue == "a")
  }

  @Test
  func selectValueJavaScriptEscapesUserValue() throws {
    let javascript = try ComputerUsePageRuntime.selectValueJavaScript(value: #"A "quoted" option"#)

    #expect(javascript.contains(#""a \"quoted\" option""#))
    #expect(javascript.contains("dispatchEvent"))
  }

  @Test
  func browserEnumMapsToBundleIDs() {
    #expect(SupatermComputerUsePageBrowser.chrome.bundleID == "com.google.Chrome")
    #expect(SupatermComputerUsePageBrowser.safari.bundleID == "com.apple.Safari")
  }

  @Test
  func appleEventsPermissionMessagesAreClean() {
    let safariError =
      "/var/folders/tmp/script.applescript: execution error: Safari got an error: "
      + "You must enable 'Allow JavaScript from Apple Events' in the Developer section "
      + "of Safari Settings to use 'do JavaScript'. (8)"
    let safari = ComputerUsePageRuntime.appleEventsPermissionMessage(
      detail: safariError,
      appName: "Safari",
      bundleID: "com.apple.Safari"
    )
    let chrome = ComputerUsePageRuntime.appleEventsPermissionMessage(
      detail: "Executing JavaScript through AppleScript is turned off.",
      appName: "Google Chrome",
      bundleID: "com.google.Chrome"
    )
    let expectedSafari =
      "Safari requires Allow JavaScript from Apple Events. "
      + "Run `sp computer-use page enable-javascript-apple-events --browser safari`, then retry."
    let expectedChrome =
      "Google Chrome requires JavaScript from Apple Events. "
      + "Run `sp computer-use page enable-javascript-apple-events --browser chrome`, then retry."

    #expect(safari == expectedSafari)
    #expect(chrome == expectedChrome)
    #expect(safari?.contains("/var") == false)
    #expect(safari?.contains("osascript") == false)
  }

  @Test
  func axPageReaderExtractsTextAndMapsSelectors() {
    let elements = [
      PageAXElement(
        role: "AXWindow",
        title: "Ignored",
        value: nil,
        description: nil,
        identifier: nil,
        help: nil
      ),
      PageAXElement(
        role: "AXHeading",
        title: "Welcome",
        value: nil,
        description: nil,
        identifier: nil,
        help: nil
      ),
      PageAXElement(
        role: "AXLink",
        title: "Docs",
        value: nil,
        description: nil,
        identifier: "docs-link",
        help: nil
      ),
    ]

    #expect(AXPageReader.extractText(from: elements) == "Welcome\nDocs")
    #expect(AXPageReader.query(selector: "a.primary", from: elements).map(\.role) == ["AXLink"])
    #expect(AXPageReader.tag(for: "AXLink") == "a")
  }

  @Test
  func pageErrorCodesAreStable() {
    #expect(ComputerUseError.pageTargetRequired.code == "page_target_required")
    #expect(ComputerUseError.pageUnsupported("x").code == "page_unsupported")
    #expect(ComputerUseError.pagePermissionRequired("x").code == "page_permission_required")
    #expect(ComputerUseError.pageExecutionFailed("x").code == "page_execution_failed")
    #expect(ComputerUseError.pageTimedOut("x").code == "page_timed_out")
  }
}
