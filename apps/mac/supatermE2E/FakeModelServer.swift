import Foundation
import Network
import SupatermCLIShared

nonisolated struct FakeModelExchange: Sendable {
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

  init(
    request: Request,
    response: Response,
    waitForRelease: Bool = false,
    failuresBeforeResponse: Int = 0
  ) {
    self.request = request
    self.response = response
    self.waitForRelease = waitForRelease
    self.failuresBeforeResponse = failuresBeforeResponse
  }

  fileprivate var consumingOneFailure: FakeModelExchange {
    FakeModelExchange(
      request: request,
      response: response,
      waitForRelease: waitForRelease,
      failuresBeforeResponse: failuresBeforeResponse - 1
    )
  }
}

nonisolated final class FakeModelServer: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "app.supabit.supaterm.e2e.fake-model")
  private let startup = DispatchSemaphore(value: 0)
  private var script: [FakeModelExchange]
  private var failure: String?
  private var pendingResponses: [(body: Data, connection: NWConnection)] = []
  private var responseReleaseCount = 0
  private var responseIndex = 0
  private var port: UInt16 = 0

  init(script: [FakeModelExchange]) throws {
    self.script = script
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
    listener.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .failed(let error):
        failure = "Fake model server failed to start: \(error)"
        startup.signal()
      case .ready:
        startup.signal()
      default:
        break
      }
    }
    listener.newConnectionHandler = { [weak self] connection in
      self?.accept(connection)
    }
    listener.start(queue: queue)
    guard startup.wait(timeout: .now() + 10) == .success else {
      listener.cancel()
      throw SupatermE2EError("Timed out starting the fake model server.")
    }
    if let failure {
      listener.cancel()
      throw SupatermE2EError(failure)
    }
    guard let listenerPort = listener.port else {
      listener.cancel()
      throw SupatermE2EError("Fake model server has no port.")
    }
    port = listenerPort.rawValue
  }

  var baseURL: String {
    "http://127.0.0.1:\(port)"
  }

  var responsesBaseURL: String {
    baseURL + "/v1"
  }

  func stop() {
    queue.sync {
      for response in pendingResponses {
        response.connection.cancel()
      }
      pendingResponses.removeAll()
    }
    listener.cancel()
  }

  func verifyComplete() throws {
    let result = queue.sync {
      (failure, script.count, pendingResponses.count, responseReleaseCount)
    }
    if let failure = result.0 {
      throw SupatermE2EError(failure)
    }
    guard result.1 == 0 else {
      throw SupatermE2EError("Fake model server has \(result.1) unused responses.")
    }
    guard result.2 == 0, result.3 == 0 else {
      throw SupatermE2EError("Fake model server has an unmatched response release.")
    }
  }

  var recordedFailure: String? {
    queue.sync { failure }
  }

  func releaseNextResponse() {
    queue.sync {
      guard !pendingResponses.isEmpty else {
        responseReleaseCount += 1
        return
      }
      let response = pendingResponses.removeFirst()
      sendResponse(response.body, to: response.connection)
    }
  }

  private func accept(_ connection: NWConnection) {
    connection.start(queue: queue)
    receive(connection, buffer: Data())
  }

  private func receive(_ connection: NWConnection, buffer: Data) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) {
      [weak self] data, _, complete, error in
      guard let self else { return }
      var nextBuffer = buffer
      if let data {
        nextBuffer.append(data)
      }
      if let request = FakeModelHTTPRequest(data: nextBuffer) {
        respond(to: request, connection: connection)
      } else if let error {
        recordFailure("Fake model server receive failed: \(error)")
        connection.cancel()
      } else if complete {
        recordFailure("Fake model server received an incomplete request.")
        connection.cancel()
      } else {
        receive(connection, buffer: nextBuffer)
      }
    }
  }

  private func respond(to request: FakeModelHTTPRequest, connection: NWConnection) {
    if request.method == "HEAD", request.path == "/api/hello" {
      send(status: "200 OK", contentType: "application/json", body: Data(), to: connection)
      return
    }
    if request.method == "POST", request.path == "/v1/messages/count_tokens" {
      send(
        status: "200 OK",
        contentType: "application/json",
        body: Data("{\"input_tokens\":1}".utf8),
        to: connection
      )
      return
    }
    guard request.method == "POST" else {
      fail("Unexpected fake model request: \(request.method) \(request.path)", connection: connection)
      return
    }
    guard let body = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any] else {
      fail("Fake model server received invalid JSON.", connection: connection)
      return
    }
    if let titleResponse = titleResponse(path: request.path, body: body) {
      responseIndex += 1
      do {
        let response = try titleResponse.sse(index: responseIndex)
        sendResponse(response, to: connection)
      } catch {
        fail("Fake model server could not encode a title response: \(error)", connection: connection)
      }
      return
    }
    guard let exchange = script.first else {
      fail("Fake model server received an extra request.", connection: connection)
      return
    }
    guard request.path == exchange.request.path else {
      fail(
        "Unexpected fake model path \(request.path); expected \(exchange.request.path).",
        connection: connection
      )
      return
    }
    guard exchange.request.wire == exchange.response.wire else {
      fail("Fake model exchange mixes wire protocols.", connection: connection)
      return
    }
    guard exchange.request.matches(body) else {
      fail(
        "Fake model request did not match \(exchange.request.name); "
          + "body keys: \(body.keys.sorted().joined(separator: ", ")); "
          + "message shape: \(messagesShape(body)); "
          + "input shape: \(responsesInputShape(body)).",
        connection: connection
      )
      return
    }
    if exchange.failuresBeforeResponse > 0 {
      script[0] = exchange.consumingOneFailure
      send(
        status: "503 Service Unavailable",
        contentType: "application/json",
        body: Data(#"{"error":{"message":"E2E reconnect drill"}}"#.utf8),
        to: connection
      )
      return
    }
    script.removeFirst()
    responseIndex += 1
    do {
      let body = try exchange.response.sse(index: responseIndex)
      if exchange.waitForRelease, responseReleaseCount == 0 {
        pendingResponses.append((body, connection))
      } else {
        if exchange.waitForRelease {
          responseReleaseCount -= 1
        }
        sendResponse(body, to: connection)
      }
    } catch {
      fail("Fake model server could not encode a response: \(error)", connection: connection)
    }
  }

  private func fail(_ message: String, connection: NWConnection) {
    recordFailure(message)
    let body =
      (try? JSONSerialization.data(
        withJSONObject: ["error": message],
        options: [.sortedKeys]
      )) ?? Data("{\"error\":\"script mismatch\"}".utf8)
    send(
      status: "500 Internal Server Error",
      contentType: "application/json",
      body: body,
      to: connection
    )
  }

  private func sendResponse(_ body: Data, to connection: NWConnection) {
    send(
      status: "200 OK",
      contentType: "text/event-stream",
      body: body,
      to: connection
    )
  }

  private func send(status: String, contentType: String, body: Data, to connection: NWConnection) {
    let header = Data(
      "HTTP/1.1 \(status)\r\nContent-Type: \(contentType)\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
        .utf8
    )
    connection.send(
      content: header + body,
      completion: .contentProcessed { _ in
        connection.cancel()
      })
  }

  private func recordFailure(_ message: String) {
    if failure == nil {
      failure = message
    }
  }

  private func messagesShape(_ body: [String: Any]) -> String {
    guard let messages = body["messages"] as? [[String: Any]] else { return "none" }
    return messages.map { message in
      let role = message["role"] as? String ?? "unknown"
      let content = message["content"]
      if content is String {
        return "\(role):string"
      }
      if let blocks = content as? [[String: Any]] {
        let types = blocks.compactMap { $0["type"] as? String }.joined(separator: "+")
        return "\(role):[\(types)]"
      }
      return "\(role):unknown"
    }.joined(separator: ",")
  }

  private func responsesInputShape(_ body: [String: Any]) -> String {
    guard let input = body["input"] else { return "none" }
    guard let items = input as? [Any] else { return String(describing: type(of: input)) }
    return items.map { item in
      guard let object = item as? [String: Any] else {
        return String(describing: type(of: item))
      }
      let role = object["role"] as? String
      let type = object["type"] as? String
      return [role, type].compactMap { $0 }.joined(separator: ":")
    }.joined(separator: ";")
  }

  private func titleResponse(
    path: String,
    body: [String: Any]
  ) -> FakeModelExchange.Response? {
    let title = #"{"title":"E2E title"}"#
    if path == "/v1/messages", isMessagesTitleRequest(body) {
      return .messagesText(title)
    }
    if path == "/v1/responses", isResponsesTitleRequest(body) {
      return .responsesMessage(title)
    }
    return nil
  }

  private func isMessagesTitleRequest(_ body: [String: Any]) -> Bool {
    guard let tools = body["tools"] as? [Any], tools.isEmpty,
      let outputConfig = body["output_config"] as? [String: Any],
      let format = outputConfig["format"] as? [String: Any],
      format["type"] as? String == "json_schema",
      let schema = format["schema"] as? [String: Any],
      schema["type"] as? String == "object",
      schema["additionalProperties"] as? Bool == false,
      schema["required"] as? [String] == ["title"],
      let properties = schema["properties"] as? [String: Any],
      properties.count == 1,
      let title = properties["title"] as? [String: Any],
      title["type"] as? String == "string"
    else {
      return false
    }
    return true
  }

  private func isResponsesTitleRequest(_ body: [String: Any]) -> Bool {
    guard let input = body["input"] as? [Any] else { return false }
    return containsText("Generate a concise, single-line task title", in: input)
  }

  private func containsText(_ expected: String, in value: Any) -> Bool {
    if let string = value as? String {
      return string.contains(expected)
    }
    if let array = value as? [Any] {
      return array.contains { containsText(expected, in: $0) }
    }
    if let object = value as? [String: Any] {
      return object.values.contains { containsText(expected, in: $0) }
    }
    return false
  }
}

private nonisolated enum FakeModelWire: Sendable {
  case messages
  case responses
}

private nonisolated struct FakeModelHTTPRequest {
  let method: String
  let path: String
  let body: Data

  init?(data: Data) {
    let delimiter = Data("\r\n\r\n".utf8)
    guard let headerRange = data.range(of: delimiter) else { return nil }
    guard let header = String(bytes: data[..<headerRange.lowerBound], encoding: .utf8) else {
      return nil
    }
    let lines = header.components(separatedBy: "\r\n")
    guard let requestLine = lines.first else { return nil }
    let requestParts = requestLine.split(separator: " ")
    guard requestParts.count >= 2 else { return nil }
    let contentLength =
      lines.dropFirst().first { line in
        line.lowercased().hasPrefix("content-length:")
      }.flatMap { line in
        Int(line.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces))
      } ?? 0
    let bodyStart = headerRange.upperBound
    guard data.count >= bodyStart + contentLength else { return nil }
    method = String(requestParts[0])
    path = String(requestParts[1]).split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
    body = data.subdata(in: bodyStart..<(bodyStart + contentLength))
  }
}

extension FakeModelExchange.Request {
  fileprivate var wire: FakeModelWire {
    switch self {
    case .messagesInputText, .messagesToolResult:
      .messages
    case .responsesFunctionOutput, .responsesInputText:
      .responses
    }
  }

  fileprivate var path: String {
    switch wire {
    case .messages:
      "/v1/messages"
    case .responses:
      "/v1/responses"
    }
  }

  fileprivate var name: String {
    switch self {
    case .messagesInputText(let text), .responsesInputText(let text):
      "input text \(text)"
    case .messagesToolResult(let callID):
      "tool result \(callID)"
    case .responsesFunctionOutput(let callID):
      "function output \(callID)"
    }
  }

  fileprivate func matches(_ body: [String: Any]) -> Bool {
    switch self {
    case .messagesInputText(let expected):
      guard let messages = body["messages"] as? [[String: Any]] else { return false }
      return messages.contains { message in
        guard message["role"] as? String == "user" else { return false }
        return containsText(expected, in: message["content"])
      }
    case .messagesToolResult(let callID):
      guard let messages = body["messages"] as? [[String: Any]] else { return false }
      return messages.contains { message in
        guard message["role"] as? String == "user",
          let content = message["content"] as? [[String: Any]]
        else { return false }
        return content.contains { block in
          block["type"] as? String == "tool_result"
            && block["tool_use_id"] as? String == callID
        }
      }
    case .responsesFunctionOutput(let callID):
      guard let input = body["input"] as? [[String: Any]] else { return false }
      return input.contains { item in
        item["type"] as? String == "function_call_output"
          && item["call_id"] as? String == callID
      }
    case .responsesInputText(let expected):
      guard let input = body["input"] as? [[String: Any]] else { return false }
      return input.contains { item in
        guard item["type"] as? String == "message",
          item["role"] as? String == "user",
          let content = item["content"] as? [[String: Any]]
        else { return false }
        return content.contains { span in
          span["type"] as? String == "input_text"
            && (span["text"] as? String)?.contains(expected) == true
        }
      }
    }
  }

  private func containsText(_ expected: String, in value: Any?) -> Bool {
    if let string = value as? String {
      return string.contains(expected)
    }
    if let array = value as? [Any] {
      return array.contains { containsText(expected, in: $0) }
    }
    if let object = value as? [String: Any] {
      return object.values.contains { containsText(expected, in: $0) }
    }
    return false
  }
}

extension FakeModelExchange.Response {
  fileprivate var wire: FakeModelWire {
    switch self {
    case .messagesText, .messagesToolUse:
      .messages
    case .responsesMessage, .responsesRequestUserInput, .responsesExecCommand:
      .responses
    }
  }

  fileprivate func sse(index: Int) throws -> Data {
    switch self {
    case .messagesText(let text):
      return try messagesSSE(
        index: index,
        contentBlock: ["type": "text", "text": ""],
        delta: ["type": "text_delta", "text": text],
        stopReason: "end_turn"
      )
    case .messagesToolUse(let callID, let name, let input):
      let encoder = JSONEncoder()
      encoder.outputFormatting = [.sortedKeys]
      let inputData = try encoder.encode(input)
      guard let partialJSON = String(data: inputData, encoding: .utf8) else {
        throw SupatermE2EError("Fake Messages tool input is not UTF-8.")
      }
      return try messagesSSE(
        index: index,
        contentBlock: [
          "type": "tool_use",
          "id": callID,
          "name": name,
          "input": [String: Any](),
        ],
        delta: ["type": "input_json_delta", "partial_json": partialJSON],
        stopReason: "tool_use"
      )
    case .responsesMessage, .responsesRequestUserInput, .responsesExecCommand:
      return try responsesSSE(index: index)
    }
  }

  private func messagesSSE(
    index: Int,
    contentBlock: [String: Any],
    delta: [String: Any],
    stopReason: String
  ) throws -> Data {
    try encodeSSE([
      (
        "message_start",
        [
          "type": "message_start",
          "message": [
            "id": "msg_e2e_\(index)",
            "type": "message",
            "role": "assistant",
            "content": [Any](),
            "model": "claude-sonnet-4-5",
            "stop_reason": NSNull(),
            "stop_sequence": NSNull(),
            "usage": [
              "cache_creation_input_tokens": 0,
              "cache_read_input_tokens": 0,
              "input_tokens": 1,
              "output_tokens": 0,
            ],
          ],
        ]
      ),
      (
        "content_block_start",
        [
          "type": "content_block_start",
          "index": 0,
          "content_block": contentBlock,
        ]
      ),
      (
        "content_block_delta",
        [
          "type": "content_block_delta",
          "index": 0,
          "delta": delta,
        ]
      ),
      (
        "content_block_stop",
        [
          "type": "content_block_stop",
          "index": 0,
        ]
      ),
      (
        "message_delta",
        [
          "type": "message_delta",
          "delta": [
            "stop_reason": stopReason,
            "stop_sequence": NSNull(),
          ],
          "usage": ["output_tokens": 1],
        ]
      ),
      ("message_stop", ["type": "message_stop"]),
    ])
  }

  private func responsesSSE(index: Int) throws -> Data {
    let responseID = "response-\(index)"
    let item: [String: Any]
    switch self {
    case .responsesMessage(let text):
      item = [
        "type": "message",
        "role": "assistant",
        "id": "message-\(index)",
        "content": [["type": "output_text", "text": text]],
      ]
    case .responsesRequestUserInput(let callID, let question):
      item = try responsesFunctionCall(
        callID: callID,
        name: "request_user_input",
        arguments: [
          "questions": [
            [
              "id": "lifecycle",
              "header": "E2E",
              "question": question,
              "options": [
                [
                  "label": "Proceed (Recommended)",
                  "description": "Continue the lifecycle test.",
                ],
                [
                  "label": "Stop",
                  "description": "Stop the lifecycle test.",
                ],
              ],
            ]
          ]
        ]
      )
    case .responsesExecCommand(let callID, let command):
      item = try responsesFunctionCall(
        callID: callID,
        name: "exec_command",
        arguments: [
          "cmd": command,
          "justification": "Allow the E2E command to run outside the read-only sandbox?",
          "sandbox_permissions": "require_escalated",
          "timeout_ms": 60_000,
        ]
      )
    case .messagesText, .messagesToolUse:
      throw SupatermE2EError("Fake Messages response cannot use the Responses wire protocol.")
    }
    return try encodeSSE([
      ("response.created", ["type": "response.created", "response": ["id": responseID]]),
      ("response.output_item.done", ["type": "response.output_item.done", "item": item]),
      (
        "response.completed",
        [
          "type": "response.completed",
          "response": [
            "id": responseID,
            "usage": [
              "input_tokens": 0,
              "input_tokens_details": NSNull(),
              "output_tokens": 0,
              "output_tokens_details": NSNull(),
              "total_tokens": 0,
            ],
          ],
        ]
      ),
    ])
  }

  private func responsesFunctionCall(
    callID: String,
    name: String,
    arguments: [String: Any]
  ) throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: arguments, options: [.sortedKeys])
    guard let encoded = String(data: data, encoding: .utf8) else {
      throw SupatermE2EError("Fake Responses tool arguments are not UTF-8.")
    }
    return [
      "type": "function_call",
      "call_id": callID,
      "name": name,
      "arguments": encoded,
    ]
  }
}

private func encodeSSE(_ events: [(name: String, data: [String: Any])]) throws -> Data {
  var body = Data()
  for event in events {
    body.append(Data("event: \(event.name)\ndata: ".utf8))
    body.append(try JSONSerialization.data(withJSONObject: event.data, options: [.sortedKeys]))
    body.append(Data("\n\n".utf8))
  }
  return body
}
