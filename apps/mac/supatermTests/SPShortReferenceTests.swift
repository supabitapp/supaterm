import ArgumentParser
import Foundation
import Testing

@testable import SPCLI

struct SPShortReferenceTests {
  @Test
  func targetParsersAcceptTypedShortRefs() throws {
    #expect(
      try parseSpaceReference("S:A6E57B1B")
        == .short(SPShortReference(kind: .space, prefix: "a6e57b1b"))
    )
    #expect(
      try parseGroupReference("g:5A52445E")
        == .short(SPShortReference(kind: .group, prefix: "5a52445e"))
    )
    #expect(
      try parseTabReference("t:6BFC889D2")
        == .short(SPShortReference(kind: .tab, prefix: "6bfc889d2"))
    )
    #expect(
      try parsePaneReference("p:2B8B3A57D7F84EF7930F46B1F7281B2A")
        == .short(
          SPShortReference(kind: .pane, prefix: "2b8b3a57d7f84ef7930f46b1f7281b2a")
        )
    )
    #expect(
      try parseContainerReference("t:6bfc889d")
        == .tab(.short(SPShortReference(kind: .tab, prefix: "6bfc889d")))
    )
    #expect(
      try parseContainerReference("p:2b8b3a57")
        == .pane(.short(SPShortReference(kind: .pane, prefix: "2b8b3a57")))
    )
  }

  @Test
  func targetParsersRejectMalformedAndWrongKindRefs() {
    for value in ["s:1234567", "s:123456789012345678901234567890123", "s:1234567z"] {
      #expect(throws: ValidationError.self) {
        _ = try parseSpaceReference(value)
      }
    }
    #expect(throws: ValidationError.self) {
      _ = try parseSpaceReference("g:5a52445e")
    }
    #expect(throws: ValidationError.self) {
      _ = try parseGroupReference("p:2b8b3a57")
    }
    #expect(throws: ValidationError.self) {
      _ = try parseGroupReference("g:not-a-ref")
    }
    #expect(throws: ValidationError.self) {
      _ = try parseContainerReference("s:a6e57b1b")
    }
    #expect(throws: (any Error).self) {
      _ = try SP.parseAsRoot(["group", "collapse", "p:2b8b3a57"])
    }
  }

  @Test
  func shortRefsLengthenOnSameKindCollisions() throws {
    let first = UUID(uuidString: "AAAAAAAA-0000-4000-8000-000000000001")!
    let second = UUID(uuidString: "AAAAAAAA-1000-4000-8000-000000000002")!
    let reference = SPShortReference(kind: .tab, prefix: "aaaaaaaa0")

    #expect(
      SPShortReference.display(kind: .tab, id: first, among: [first, second])
        == "t:aaaaaaaa0"
    )
    #expect(
      SPShortReference.display(kind: .tab, id: second, among: [first, second])
        == "t:aaaaaaaa1"
    )
    #expect(try reference.resolve(in: [first, second]) == first)
    #expect(throws: ValidationError.self) {
      _ = try SPShortReference(kind: .tab, prefix: "aaaaaaaa").resolve(
        in: [first, second]
      )
    }
    #expect(
      SPShortReference.display(kind: .space, id: first, among: [first, first])
        == "s:aaaaaaaa"
    )
  }

  @Test
  func paneSendDoesNotTreatTypedTargetsAsText() throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }

    let malformed = try cli.run(["pane", "send", "p:1234567", "hello"])
    let wrongKind = try cli.run(["pane", "send", "t:6bfc889d", "hello"])

    #expect(malformed.exitCode != 0)
    #expect(malformed.stderr.contains("8 to 32 UUID hex characters"))
    #expect(wrongKind.exitCode != 0)
    #expect(wrongKind.stderr.contains("Expected a pane ref"))
    #expect(!wrongKind.stderr.contains("No reachable Supaterm instance"))
  }
}
