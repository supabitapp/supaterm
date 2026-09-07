import Foundation
import SupatermCLIShared

nonisolated struct FakeModelExchange: Encodable, Sendable {
  enum Request: Sendable {
    case messagesInputText(String)
    case messagesToolResult(callID: String)
    case responsesFunctionOutput(callID: String)
    case responsesInputText(String)
  }

  enum Response: Sendable {
    case messagesText(String)
    case messagesToolUse(callID: String, name: String, input: JSONValue)
    case responsesMessage(String)
    case responsesRequestUserInput(callID: String, question: String)
    case responsesExecCommand(callID: String, command: String)

    static func messagesAskUserQuestion(callID: String, question: String) -> Self {
      .messagesToolUse(
        callID: callID,
        name: "AskUserQuestion",
        input: [
          "questions": .array([
            .object([
              "header": "E2E",
              "multiSelect": false,
              "options": [
                [
                  "description": "Continue the lifecycle test.",
                  "label": "Proceed",
                ],
                [
                  "description": "Stop the lifecycle test.",
                  "label": "Stop",
                ],
              ],
              "question": .string(question),
            ])
          ])
        ]
      )
    }

    static func messagesBash(callID: String, command: String) -> Self {
      .messagesToolUse(
        callID: callID,
        name: "Bash",
        input: ["command": .string(command)]
      )
    }
  }

  let request: Request
  let response: Response
  let waitForRelease: Bool
  let failuresBeforeResponse: Int
  let options: JSONValue

  init(
    request: Request,
    response: Response,
    waitForRelease: Bool = false,
    failuresBeforeResponse: Int = 0,
    options: JSONValue = [:]
  ) {
    self.request = request
    self.response = response
    self.waitForRelease = waitForRelease
    self.failuresBeforeResponse = failuresBeforeResponse
    self.options = options
  }

  func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(request.match, forKey: .match)
    try container.encode(response.fixture, forKey: .response)
    try container.encode(waitForRelease, forKey: .waitForRelease)
    try container.encode(failuresBeforeResponse, forKey: .failuresBeforeResponse)
    try container.encode(options, forKey: .options)
  }

  private enum CodingKeys: String, CodingKey {
    case match, response, waitForRelease, failuresBeforeResponse, options
  }
}

extension FakeModelExchange.Request {
  fileprivate var match: JSONValue {
    switch self {
    case .messagesInputText(let text):
      ["context": "messages", "userMessage": .string(text)]
    case .messagesToolResult(let callID):
      ["context": "messages", "toolCallId": .string(callID)]
    case .responsesInputText(let text):
      ["context": "responses", "userMessage": .string(text)]
    case .responsesFunctionOutput(let callID):
      ["context": "responses", "toolCallId": .string(callID)]
    }
  }
}

extension FakeModelExchange.Response {
  fileprivate var fixture: JSONValue {
    switch self {
    case .messagesText(let text), .responsesMessage(let text):
      return ["content": .string(text)]
    case .messagesToolUse(let callID, let name, let input):
      // Claude enables thinking; tool-loop continuations must preserve a signed thinking block.
      return toolCall(callID: callID, name: name, arguments: input, reasoning: "Running the scripted E2E tool.")
    case .responsesRequestUserInput(let callID, let question):
      return toolCall(
        callID: callID,
        name: "request_user_input",
        arguments: [
          "questions": [
            [
              "id": "lifecycle",
              "header": "E2E",
              "question": .string(question),
              "options": [
                ["label": "Proceed (Recommended)", "description": "Continue the lifecycle test."],
                ["label": "Stop", "description": "Stop the lifecycle test."],
              ],
            ]
          ]
        ]
      )
    case .responsesExecCommand(let callID, let command):
      return toolCall(
        callID: callID,
        name: "exec_command",
        arguments: [
          "cmd": .string(command),
          "justification": "Allow the E2E command to run outside the read-only sandbox?",
          "sandbox_permissions": "require_escalated",
          "timeout_ms": 60_000,
        ]
      )
    }
  }

  private func toolCall(
    callID: String,
    name: String,
    arguments: JSONValue,
    reasoning: String? = nil
  ) -> JSONValue {
    var response: [String: JSONValue] = [
      "toolCalls": [["id": .string(callID), "name": .string(name), "arguments": arguments]]
    ]
    if let reasoning { response["reasoning"] = .string(reasoning) }
    return .object(response)
  }
}
