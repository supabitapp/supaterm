import { formatAssistantCitationHref } from "@supaterm/shared/assistantCitations";
import { describe, expect, it } from "vite-plus/test";

import {
  REMOVE_QUEUED_MESSAGE_ACCESSIBILITY_LABEL,
  resolveThreadQueueRowControls,
} from "./threadQueueControlPresentation";

describe("threadQueueControlPresentation", () => {
  it.each([
    { busy: false, isEditing: false, expected: true },
    { busy: true, isEditing: false, expected: false },
    { busy: false, isEditing: true, expected: false },
  ])(
    "gates sending a stopped thread's queued message with $busy busy and $isEditing editing",
    ({ busy, isEditing, expected }) => {
      const controls = resolveThreadQueueRowControls({
        canOperate: true,
        busy,
        isEditing,
        canPromoteToSteer: false,
        canSendNow: true,
        text: "Queued message",
      });

      expect(controls.canSend).toBe(expected);
    },
  );

  it("shows an assistant quote as its quoted text", () => {
    const href = formatAssistantCitationHref({
      version: 1,
      environmentId: "environment:test" as never,
      threadId: "thread:test" as never,
      messageId: "message:assistant" as never,
      text: "Retry the sync after the lock clears.",
      start: 0,
      end: 37,
      prefix: "",
      suffix: "",
    });
    const controls = resolveThreadQueueRowControls({
      canOperate: true,
      busy: false,
      canPromoteToSteer: true,
      canSendNow: false,
      text: `[Assistant quote](${href}) Can we add a backoff here?`,
    });

    expect(controls.displayText).toBe(
      "Retry the sync after the lock clears. Can we add a backoff here?",
    );
  });

  it("preserves sending and removal", () => {
    const controls = resolveThreadQueueRowControls({
      canOperate: true,
      busy: false,
      canPromoteToSteer: true,
      canSendNow: false,
      text: "Please review the follow-up change.",
    });

    expect(controls.displayText).toBe("Please review the follow-up change.");
    expect(controls.canSend).toBe(true);
    expect(controls.canDismiss).toBe(true);
    expect(controls.canOpen).toBe(true);
    expect(controls.dismissAccessibilityLabel).toBe(REMOVE_QUEUED_MESSAGE_ACCESSIBILITY_LABEL);
  });

  it("disables unavailable sending and busy dismissal", () => {
    const first = resolveThreadQueueRowControls({
      canOperate: true,
      busy: false,
      canPromoteToSteer: false,
      canSendNow: false,
      text: "First",
    });
    const busy = resolveThreadQueueRowControls({
      canOperate: true,
      busy: true,
      canPromoteToSteer: true,
      canSendNow: false,
      text: "Queued message",
    });
    expect(first.canSend).toBe(false);
    expect(busy.canDismiss).toBe(false);
    expect(busy.canOpen).toBe(false);
    expect(busy.canSend).toBe(false);
  });

  it("lets an edited row return to the composer without reloading or steering", () => {
    const editing = resolveThreadQueueRowControls({
      canOperate: true,
      busy: false,
      canPromoteToSteer: true,
      canSendNow: false,
      isEditing: true,
      text: "Being edited",
    });

    expect(editing.isEditing).toBe(true);
    expect(editing.canOpen).toBe(true);
    expect(editing.canEdit).toBe(false);
    expect(editing.canSend).toBe(false);
    expect(editing.canDismiss).toBe(true);
  });

  it("disables every queue mutation on a read-only connection", () => {
    const controls = resolveThreadQueueRowControls({
      canOperate: false,
      busy: false,
      canPromoteToSteer: true,
      canSendNow: false,
      text: "Queued message",
    });
    expect(controls).toMatchObject({
      canDismiss: false,
      canEdit: false,
      canOpen: false,
      canSend: false,
      displayText: "Queued message",
    });
  });

  it("lets the owner cancel a guest's queued message but not rewrite it", () => {
    const guest = resolveThreadQueueRowControls({
      canOperate: true,
      busy: false,
      canPromoteToSteer: true,
      canSendNow: false,
      isGuestMessage: true,
      text: "Why?",
    });

    expect(guest.canEdit).toBe(false);
    expect(guest.canDismiss).toBe(true);
  });
  it("keeps the editor closed while a question owns the composer", () => {
    const controls = resolveThreadQueueRowControls({
      canOperate: true,
      busy: false,
      canPromoteToSteer: true,
      canSendNow: false,
      editBlocked: true,
      text: "Queued text",
    });
    expect(controls.canEdit).toBe(false);
    expect(controls.canOpen).toBe(false);
    expect(controls.canDismiss).toBe(true);
  });
});
