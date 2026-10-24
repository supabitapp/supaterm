import { describe, expect, it } from "vite-plus/test";

import { classifyMarkdownImageSource } from "./markdownImages.js";

describe("classifyMarkdownImageSource", () => {
  it.each([
    ["images/result.png", "/workspace/project", "/workspace/project/images/result.png"],
    ["./images/result.png", "/workspace/project", "/workspace/project/./images/result.png"],
    [
      "images/result.png",
      "C:\\Users\\dara\\project",
      "C:\\Users\\dara\\project\\images\\result.png",
    ],
    [
      "images\\result.png",
      "C:\\Users\\dara\\project",
      "C:\\Users\\dara\\project\\images\\result.png",
    ],
    ["/workspace/project/image.png", null, "/workspace/project/image.png"],
    ["/C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["\\\\server\\share\\image.png", "\\\\server\\share", "\\\\server\\share\\image.png"],
    ["file:///workspace/project/image%20one.png", null, "/workspace/project/image one.png"],
    ["file:///C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["file://localhost/C:/Users/dara/project/image.png", null, "C:/Users/dara/project/image.png"],
    ["file://server/share/image.png", "\\\\server\\share", "\\\\server\\share\\image.png"],
  ])("maps %s to a workspace file", (source, workspaceRoot, path) => {
    expect(classifyMarkdownImageSource(source, workspaceRoot)).toEqual({
      _tag: "WorkspaceFile",
      path,
    });
  });

  it.each([
    null,
    "",
    "#image",
    "?image=1",
    "image.png",
    "~/image.png",
    "javascript:alert(1)",
    "ftp://example.com/image.png",
    "content://media/image/1",
    "custom:image.png",
    "file://%",
  ])("blocks unsupported or unresolved source %s", (source) => {
    expect(classifyMarkdownImageSource(source)).toEqual({ _tag: "Blocked" });
  });

  // Loading these makes Windows send the user's NTLM credentials to the named host.
  it.each([
    "file://attacker.test/share/cat.jpg",
    "\\\\attacker.test\\share\\cat.jpg",
    "/\\attacker.test\\share\\cat.jpg",
    "file:/%5Cattacker.test%5Cshare%5Ccat.jpg",
    "\\\\server\\other\\cat.jpg",
  ])("blocks network path %s outside the project", (source) => {
    expect(classifyMarkdownImageSource(source, "\\\\server\\share\\project")).toEqual({
      _tag: "Blocked",
    });
  });

  it("bounds network paths by the project when relative images resolve from a nested directory", () => {
    const docs = "\\\\nas.test\\share\\project\\docs";
    const project = "\\\\nas.test\\share\\project";
    expect(
      classifyMarkdownImageSource("file://nas.test/share/project/images/logo.png", docs, project),
    ).toEqual({ _tag: "WorkspaceFile", path: "\\\\nas.test\\share\\project\\images\\logo.png" });
    expect(
      classifyMarkdownImageSource("file://nas.test/share/other/logo.png", docs, project),
    ).toEqual({ _tag: "Blocked" });
  });
});
