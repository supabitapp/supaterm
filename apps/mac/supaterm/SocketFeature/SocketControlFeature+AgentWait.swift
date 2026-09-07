import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSupport

extension SocketControlFeature {
  func waitResponse(
    for request: SocketControlClient.Request,
    notificationOutputClient: NotificationOutputClient,
    socketControlClient: SocketControlClient,
    socketRequestExecutor: SocketRequestExecutor
  ) async -> SupatermSocketResponse? {
    @Dependency(\.continuousClock) var clock
    return await withTaskGroup(of: SupatermSocketResponse?.self) { group in
      group.addTask {
        await self.response(
          for: request.payload,
          notificationOutputClient: notificationOutputClient,
          socketControlClient: socketControlClient,
          socketRequestExecutor: socketRequestExecutor
        )
      }
      group.addTask { [clock] in
        while !Task.isCancelled, await socketControlClient.isPending(request.handle) {
          do {
            try await clock.sleep(for: .milliseconds(100))
          } catch {
            return nil
          }
        }
        return nil
      }
      for await reply in group {
        group.cancelAll()
        return reply
      }
      return nil
    }
  }
}
