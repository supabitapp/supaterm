import Foundation
import SupatermCLIShared

extension SocketControlFeature {
  func appResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    if let response = try await appSettingsResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    if let response = try await appHooksResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    if let response = try await appSkillsResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }

    switch request.method {
    case SupatermSocketMethod.appAgentDetectionReload:
      let result = try await socketRequestExecutor.executeAgentIntegration(.detectionReload)
      guard case .detectionReload(let reload) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: reload)

    case SupatermSocketMethod.appOnboarding:
      let result = try await socketRequestExecutor.executeApp(.onboardingSnapshot)
      guard case .onboardingSnapshot(let snapshot) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      guard let snapshot else {
        throw SocketRequestError.onboardingUnavailable
      }
      return try .ok(id: request.id, encodableResult: snapshot)

    case SupatermSocketMethod.appDebug:
      let payload = try request.decodeParams(SupatermDebugRequest.self)
      let result = try await socketRequestExecutor.executeApp(.debugSnapshot(payload))
      guard case .debugSnapshot(let snapshot) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: snapshot)

    case SupatermSocketMethod.appTree:
      let result = try await socketRequestExecutor.executeApp(.treeSnapshot)
      guard case .treeSnapshot(let snapshot) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: snapshot)

    case SupatermSocketMethod.appQuit:
      let result = try await socketRequestExecutor.executeApp(.quit)
      guard case .quit = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return .ok(id: request.id)

    default:
      return nil
    }
  }

  private func appSettingsResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.appSettingsList:
      let payload = try request.decodeParams(SupatermSettingsListRequest.self)
      let result = try await socketRequestExecutor.executeApp(.settingsList(payload))
      guard case .settingsList(let settingsResult) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: settingsResult)

    case SupatermSocketMethod.appSettingsGet:
      let payload = try request.decodeParams(SupatermSettingsGetRequest.self)
      let result = try await socketRequestExecutor.executeApp(.settingsGet(payload))
      guard case .settingsGet(let settingsResult) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: settingsResult)

    case SupatermSocketMethod.appSettingsSet:
      let payload = try request.decodeParams(SupatermSettingsSetRequest.self)
      let result = try await socketRequestExecutor.executeApp(.settingsSet(payload))
      guard case .settingsSet(let settingsResult) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: settingsResult)

    case SupatermSocketMethod.appSettingsReset:
      let payload = try request.decodeParams(SupatermSettingsResetRequest.self)
      let result = try await socketRequestExecutor.executeApp(.settingsReset(payload))
      guard case .settingsReset(let settingsResult) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: settingsResult)

    case SupatermSocketMethod.appSettingsValidate:
      let payload = try request.decodeParams(SupatermSettingsValidateRequest.self)
      let result = try await socketRequestExecutor.executeApp(.settingsValidate(payload))
      guard case .settingsValidate(let validationResult) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: validationResult)

    default:
      return nil
    }
  }

  private func appHooksResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.appHooksInstall:
      let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
      let result = try await socketRequestExecutor.executeAgentIntegration(.hooksInstall(payload))
      guard case .hooksInstall(let health) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: health)

    case SupatermSocketMethod.appHooksRemove:
      let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
      let result = try await socketRequestExecutor.executeAgentIntegration(.hooksRemove(payload))
      guard case .hooksRemove(let health) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: health)

    default:
      return nil
    }
  }

  private func appSkillsResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.appSkillsList:
      let result = try await socketRequestExecutor.executeAgentIntegration(.skillsList)
      guard case .skillsList(let skillsResult) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: skillsResult)

    case SupatermSocketMethod.appSkillsGet:
      let payload = try request.decodeParams(SupatermSkillGetRequest.self)
      let result = try await socketRequestExecutor.executeAgentIntegration(.skillsGet(payload))
      guard case .skillsGet(let skill) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: skill)

    case SupatermSocketMethod.appSkillsPath:
      let payload = try request.decodeParams(SupatermSkillPathRequest.self)
      let result = try await socketRequestExecutor.executeAgentIntegration(.skillsPath(payload))
      guard case .skillsPath(let pathResult) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: pathResult)

    case SupatermSocketMethod.appSkillsInstall:
      let result = try await socketRequestExecutor.executeAgentIntegration(.skillsInstall)
      guard case .skillsInstall(let installResult) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: installResult)

    default:
      return nil
    }
  }
}
