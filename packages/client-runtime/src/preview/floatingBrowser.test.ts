import type { PreviewNavStatus } from "@supaterm/contracts";
import { describe, expect, it } from "vite-plus/test";

import { shouldShowFloatingBrowser } from "./floatingBrowser.ts";

const idle: PreviewNavStatus = { _tag: "Idle" };
const loading: PreviewNavStatus = {
  _tag: "Loading",
  url: "http://localhost:37285/login",
  title: "",
};
const success: PreviewNavStatus = { ...loading, _tag: "Success" };
const failed: PreviewNavStatus = {
  ...loading,
  _tag: "LoadFailed",
  code: -102,
  description: "ERR_CONNECTION_REFUSED",
};

function visibilityDuring(statuses: ReadonlyArray<PreviewNavStatus | null>): boolean[] {
  let visible = false;
  return statuses.map((status) => {
    visible = shouldShowFloatingBrowser(status, visible);
    return visible;
  });
}

describe("floating browser visibility", () => {
  it("waits for the first page, then keeps the preview during later navigation", () => {
    expect(visibilityDuring([idle, loading, success, loading, success])).toEqual([
      false,
      false,
      true,
      true,
      true,
    ]);
  });

  it("keeps a failed first navigation hidden and reveals a successful retry", () => {
    expect(visibilityDuring([idle, loading, failed, loading, success])).toEqual([
      false,
      false,
      false,
      false,
      true,
    ]);
  });

  it("hides an existing preview on failure until a retry actually loads", () => {
    expect(visibilityDuring([success, loading, failed, loading, failed, loading, success])).toEqual(
      [true, true, false, false, false, false, true],
    );
  });

  it.each([idle, null])("hides a page that is cleared or closed", (status) => {
    expect(visibilityDuring([success, status, loading])).toEqual([true, false, false]);
  });

  it.each(["", "about:blank", "about:blank#anchor", "chrome-error://chromewebdata/"])(
    "keeps an internal blank document hidden even when reported as loaded: %s",
    (url) => {
      expect(visibilityDuring([success, { ...success, url }, loading])).toEqual([
        true,
        false,
        false,
      ]);
    },
  );
});
