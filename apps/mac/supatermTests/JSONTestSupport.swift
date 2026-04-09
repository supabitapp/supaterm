import Foundation

func jsonStringLiteral(_ value: String) throws -> String {
  let data = try JSONSerialization.data(withJSONObject: [value], options: [])
  guard let string = String(data: data, encoding: .utf8) else {
    throw CocoaError(.coderInvalidValue)
  }
  guard string.count >= 2 else {
    throw CocoaError(.coderInvalidValue)
  }
  return String(string.dropFirst().dropLast())
}
