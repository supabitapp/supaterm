import ArgumentParser
import Foundation
import SupatermCLIShared

enum SPPaneKeyArgument: String, CaseIterable, ExpressibleByArgument {
  case backspace
  case ctrlC = "ctrl-c"
  case ctrlD = "ctrl-d"
  case ctrlL = "ctrl-l"
  case ctrlZ = "ctrl-z"
  case enter
  case escape
  case tab

  static var supportedKeys: String {
    allCases.map(\.rawValue).joined(separator: ", ")
  }

  var inputKey: SupatermInputKey {
    switch self {
    case .backspace:
      .backspace
    case .ctrlC:
      .ctrlC
    case .ctrlD:
      .ctrlD
    case .ctrlL:
      .ctrlL
    case .ctrlZ:
      .ctrlZ
    case .enter:
      .enter
    case .escape:
      .escape
    case .tab:
      .tab
    }
  }
}

extension SP {
  struct SendText: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "send",
      abstract: "Send literal text to a Supaterm pane.",
      discussion: SPHelp.sendTextDiscussion
    )

    @Flag(name: .long, help: "Append a newline after the provided text.")
    var newline = false

    @Flag(name: .long, help: "Paste the provided text and press Enter.")
    var submit = false

    @OptionGroup
    var options: SPCommandOptions

    @Argument(parsing: .remaining, help: "Optional pane target followed by text or `-` for stdin.")
    var arguments: [String] = []

    mutating func run() throws {
      try validate()
      let resolvedInput = try resolveInput()
      try runControlCommand(
        options: options,
        request: { try .sendText(try requestPayload(client: $0, resolvedInput: resolvedInput)) },
        as: SupatermSendTextResult.self,
        plain: {
          plainPaneSelector(
            spaceIndex: $0.spaceIndex,
            tabIndex: $0.tabIndex,
            paneIndex: $0.paneIndex
          )
        },
        human: { render($0) }
      )
    }

    func validate() throws {
      if newline && submit {
        throw ValidationError("--newline and --submit cannot be used together.")
      }
    }

    private func resolveInput() throws -> SendTextInput {
      switch arguments.count {
      case 0:
        guard stdinHasPipedInput() else {
          throw ValidationError("Provide text or pipe stdin.")
        }
        return SendTextInput(target: nil, text: readStandardInput())
      case 1:
        if let pane = try parsePaneReferenceIfTarget(arguments[0]) {
          guard stdinHasPipedInput() else {
            throw ValidationError("Pipe stdin when only a pane target is provided.")
          }
          return SendTextInput(target: pane, text: readStandardInput())
        }
        return SendTextInput(target: nil, text: try resolveText(arguments[0]))
      case 2:
        guard let pane = try parsePaneReferenceIfTarget(arguments[0]) else {
          throw ValidationError("The first argument must be a pane target.")
        }
        return SendTextInput(target: pane, text: try resolveText(arguments[1]))
      default:
        throw ValidationError("Expected at most a pane target and one text argument.")
      }
    }

    private func resolveText(_ argument: String) throws -> String {
      if argument == "-" {
        return readStandardInput()
      }
      return argument
    }

    private func requestPayload(
      client: SPSocketClient,
      resolvedInput: SendTextInput
    ) throws -> SupatermSendTextRequest {
      let text = newline ? resolvedInput.text + "\n" : resolvedInput.text
      return SupatermSendTextRequest(
        mode: submit ? .submit : .type,
        target: try resolvePublicPaneTarget(
          resolvedInput.target,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        ),
        text: text
      )
    }
  }

  struct SendKey: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "key",
      abstract: "Send a key to a Supaterm pane.",
      discussion: SPHelp.sendKeyDiscussion
    )

    @Argument(help: "Key to send: \(SPPaneKeyArgument.supportedKeys).")
    var key: SPPaneKeyArgument

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      try runControlCommand(
        options: options,
        request: { try .sendKey(try requestPayload(client: $0)) },
        as: SupatermSendKeyResult.self,
        plain: {
          plainPaneSelector(
            spaceIndex: $0.spaceIndex,
            tabIndex: $0.tabIndex,
            paneIndex: $0.paneIndex
          )
        },
        human: { render($0) }
      )
    }

    private func requestPayload(client: SPSocketClient) throws -> SupatermSendKeyRequest {
      SupatermSendKeyRequest(
        key: key.inputKey,
        target: try resolvePublicPaneTarget(
          pane,
          context: SupatermCLIContext.current,
          snapshot: try treeSnapshot(client)
        )
      )
    }
  }
}

private struct SendTextInput {
  let target: SPPaneReference?
  let text: String
}

private func parsePaneReferenceIfTarget(_ argument: String) throws -> SPPaneReference? {
  if try SPShortReference.parse(argument) != nil {
    return try parsePaneReference(argument)
  }
  return try? parsePaneReference(argument)
}

private func readStandardInput() -> String {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  return String(bytes: data, encoding: .utf8) ?? ""
}
