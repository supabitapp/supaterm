import { EnvironmentId } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { attachmentUploadBlockReason } from "./attachmentUploadState";

const environmentId = EnvironmentId.make("environment-1");

describe("attachmentUploadBlockReason", () => {
  it("asks the user to retry or remove failed uploads", () => {
    expect(
      attachmentUploadBlockReason({
        imageIds: ["image-1"],
        environmentId,
        uploadsByImageId: {
          "image-1": { status: "failed", environmentId, reason: "Upload failed" },
        },
      }),
    ).toBe("Retry or remove the failed attachment");
  });

  it("does not accept an upload from another environment", () => {
    expect(
      attachmentUploadBlockReason({
        imageIds: ["image-1"],
        environmentId,
        uploadsByImageId: {
          "image-1": {
            status: "ready",
            environmentId: EnvironmentId.make("environment-2"),
            attachmentId: "pending-1",
          },
        },
      }),
    ).toBe("Attachment still uploading");
  });
});
