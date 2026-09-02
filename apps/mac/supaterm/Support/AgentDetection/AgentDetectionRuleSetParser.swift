import Foundation
import TOML

enum AgentDetectionRuleSetParser {
  static func load(
    from bundle: Bundle,
    overrideDirectoryURL: URL? = nil
  ) throws -> AgentDetectionRuleSet {
    var documents: [Data] = []
    var loadedAgents: [AgentDetectionAgentRule] = []
    for definition in TerminalCodingAgentCatalog.activityAgents {
      guard let displayName = definition.activityDisplayName else { continue }
      guard
        let url = bundle.url(
          forResource: definition.id,
          withExtension: "toml",
          subdirectory: "AgentDetection"
        )
      else {
        throw AgentDetectionRuleSetError.missingBundledManifest(definition.id)
      }
      let overrideURL = overrideDirectoryURL?.appendingPathComponent(
        "\(definition.id).toml",
        isDirectory: false
      )
      let selectedURL =
        if let overrideURL, FileManager.default.fileExists(atPath: overrideURL.path) {
          overrideURL
        } else {
          url
        }
      let data = try Data(contentsOf: selectedURL)
      let manifest = try parse(data, path: selectedURL.path)
      guard manifest.id == definition.id else {
        throw AgentDetectionRuleSetError.unexpectedManifestID(
          expected: definition.id,
          actual: manifest.id,
          path: selectedURL.path
        )
      }
      documents.append(data)
      loadedAgents.append(
        AgentDetectionAgentRule(
          id: manifest.id,
          displayName: displayName,
          version: manifest.version,
          source: AgentDetectionManifestSource(
            origin: selectedURL == url ? .bundled : .local,
            path: selectedURL.path
          ),
          processes: definition.processes,
          rules: manifest.rules
        )
      )
    }
    return AgentDetectionRuleSet(
      generation: generation(for: documents),
      agents: loadedAgents
    )
  }

  static func parse(_ data: Data, path: String? = nil) throws -> AgentDetectionManifest {
    do {
      return try TOMLDecoder().decode(AgentDetectionManifest.self, from: data)
    } catch let error as AgentDetectionRuleSetError {
      throw error
    } catch {
      throw AgentDetectionRuleSetError.invalidDocument(path: path, detail: error.localizedDescription)
    }
  }

  private static func generation(for documents: [Data]) -> UInt64 {
    documents.reduce(UInt64(14_695_981_039_346_656_037)) { hash, document in
      document.reduce(hash ^ UInt64(document.count)) { partial, byte in
        (partial ^ UInt64(byte)) &* 1_099_511_628_211
      }
    }
  }
}

enum AgentDetectionRuleSetError: Error, Equatable, LocalizedError, Sendable {
  case missingBundledManifest(String)
  case unexpectedManifestID(expected: String, actual: String, path: String)
  case invalidDocument(path: String?, detail: String)

  var errorDescription: String? {
    switch self {
    case .missingBundledManifest(let id):
      "Bundled agent detection manifest '\(id)' is missing."
    case .unexpectedManifestID(let expected, let actual, let path):
      "Agent detection manifest at '\(path)' must declare id '\(expected)', not '\(actual)'."
    case .invalidDocument(let path, let detail):
      if let path {
        "Agent detection manifest at '\(path)' is invalid: \(detail)"
      } else {
        "Agent detection manifest is invalid: \(detail)"
      }
    }
  }
}
