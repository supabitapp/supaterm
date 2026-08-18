import Foundation
import Network

nonisolated struct CodexFakeExchange: Sendable {
  enum Request: Sendable {
    case functionOutput(callID: String)
    case inputText(String)
  }

  enum Response: Sendable {
    case message(String)
    case requestUserInput(callID: String, question: String)
    case shellCommand(callID: String, command: String)
  }

  let request: Request
  let response: Response
  let responseDelay: TimeInterval

  init(request: Request, response: Response, responseDelay: TimeInterval = 0) {
    self.request = request
    self.response = response
    self.responseDelay = responseDelay
  }
}

nonisolated final class CodexFakeModelServer: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "app.supabit.supaterm.e2e.codex-model")
  private let startup = DispatchSemaphore(value: 0)
  private var script: [CodexFakeExchange]
  private var failure: String?
  private var responseIndex = 0
  private var port: UInt16 = 0

  init(script: [CodexFakeExchange]) throws {
    self.script = script
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
    listener.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .failed(let error):
        failure = "Fake Codex server failed to start: \(error)"
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
      throw SupatermE2EError("Timed out starting the fake Codex server.")
    }
    if let failure {
      listener.cancel()
      throw SupatermE2EError(failure)
    }
    guard let listenerPort = listener.port else {
      listener.cancel()
      throw SupatermE2EError("Fake Codex server has no port.")
    }
    port = listenerPort.rawValue
  }

  var baseURL: String {
    "http://127.0.0.1:\(port)/v1"
  }

  func stop() {
    listener.cancel()
  }

  func verifyComplete() throws {
    let result = queue.sync { (failure, script.count) }
    if let failure = result.0 {
      throw SupatermE2EError(failure)
    }
    guard result.1 == 0 else {
      throw SupatermE2EError("Fake Codex server has \(result.1) unused responses.")
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
      if let request = CodexFakeHTTPRequest(data: nextBuffer) {
        respond(to: request, connection: connection)
      } else if let error {
        recordFailure("Fake Codex server receive failed: \(error)")
        connection.cancel()
      } else if complete {
        recordFailure("Fake Codex server received an incomplete request.")
        connection.cancel()
      } else {
        receive(connection, buffer: nextBuffer)
      }
    }
  }

  private func respond(to request: CodexFakeHTTPRequest, connection: NWConnection) {
    guard request.method == "POST", request.path == "/v1/responses" else {
      fail("Unexpected fake Codex request: \(request.method) \(request.path)", connection: connection)
      return
    }
    guard let body = try? JSONSerialization.jsonObject(with: request.body) as? [String: Any] else {
      fail("Fake Codex server received invalid JSON.", connection: connection)
      return
    }
    guard let exchange = script.first else {
      fail("Fake Codex server received an extra response request.", connection: connection)
      return
    }
    guard exchange.request.matches(body) else {
      fail("Fake Codex server request did not match \(exchange.request.name).", connection: connection)
      return
    }
    script.removeFirst()
    responseIndex += 1
    do {
      let body = try exchange.response.sse(index: responseIndex)
      queue.asyncAfter(deadline: .now() + exchange.responseDelay) { [weak self] in
        self?.send(
          status: "200 OK",
          contentType: "text/event-stream",
          body: body,
          to: connection
        )
      }
    } catch {
      fail("Fake Codex server could not encode a response: \(error)", connection: connection)
    }
  }

  private func fail(_ message: String, connection: NWConnection) {
    recordFailure(message)
    send(
      status: "500 Internal Server Error",
      contentType: "application/json",
      body: Data("{\"error\":\"script mismatch\"}".utf8),
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
}

private nonisolated struct CodexFakeHTTPRequest {
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
    let contentLength = lines.dropFirst().first { line in
      line.lowercased().hasPrefix("content-length:")
    }.flatMap { line in
      Int(line.split(separator: ":", maxSplits: 1)[1].trimmingCharacters(in: .whitespaces))
    }
    guard let contentLength else { return nil }
    let bodyStart = headerRange.upperBound
    guard data.count >= bodyStart + contentLength else { return nil }
    method = String(requestParts[0])
    path = String(requestParts[1]).split(separator: "?", maxSplits: 1).first.map(String.init) ?? ""
    body = data.subdata(in: bodyStart..<(bodyStart + contentLength))
  }
}

extension CodexFakeExchange.Request {
  fileprivate var name: String {
    switch self {
    case .functionOutput(let callID):
      "function output \(callID)"
    case .inputText(let text):
      "input text \(text)"
    }
  }

  fileprivate func matches(_ body: [String: Any]) -> Bool {
    guard let input = body["input"] as? [[String: Any]] else { return false }
    switch self {
    case .functionOutput(let callID):
      return input.contains { item in
        item["type"] as? String == "function_call_output"
          && item["call_id"] as? String == callID
      }
    case .inputText(let expected):
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
}

extension CodexFakeExchange.Response {
  fileprivate func sse(index: Int) throws -> Data {
    let responseID = "response-\(index)"
    let item: [String: Any]
    switch self {
    case .message(let text):
      item = [
        "type": "message",
        "role": "assistant",
        "id": "message-\(index)",
        "content": [["type": "output_text", "text": text]],
      ]
    case .requestUserInput(let callID, let question):
      item = try functionCall(
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
    case .shellCommand(let callID, let command):
      item = try functionCall(
        callID: callID,
        name: "shell_command",
        arguments: ["command": command, "timeout_ms": 60_000]
      )
    }
    let events: [[String: Any]] = [
      ["type": "response.created", "response": ["id": responseID]],
      ["type": "response.output_item.done", "item": item],
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
      ],
    ]
    var body = Data()
    for event in events {
      guard let type = event["type"] as? String else {
        throw SupatermE2EError("Fake Codex event has no type.")
      }
      body.append(Data("event: \(type)\ndata: ".utf8))
      body.append(try JSONSerialization.data(withJSONObject: event, options: [.sortedKeys]))
      body.append(Data("\n\n".utf8))
    }
    return body
  }

  private func functionCall(
    callID: String,
    name: String,
    arguments: [String: Any]
  ) throws -> [String: Any] {
    let data = try JSONSerialization.data(withJSONObject: arguments, options: [.sortedKeys])
    guard let encoded = String(data: data, encoding: .utf8) else {
      throw SupatermE2EError("Fake Codex tool arguments are not UTF-8.")
    }
    return [
      "type": "function_call",
      "call_id": callID,
      "name": name,
      "arguments": encoded,
    ]
  }
}
