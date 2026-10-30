import { describe, expect, it } from "vite-plus/test";
import {
  addPreparingComposerImages,
  countPreparingComposerImages,
  isPreparingComposerImage,
  removePreparingComposerImages,
} from "./preparingComposerImages";

const image = (id: string) => ({
  id,
  name: id,
  file: new File(["pixels"], id, { type: "image/png" }),
});
describe("preparing composer images", () => {
  it("reserves simultaneous pastes independently in each draft", () => {
    addPreparingComposerImages("first", [image("a")]);
    addPreparingComposerImages("first", [image("b")]);
    addPreparingComposerImages("second", [image("a")]);
    expect(countPreparingComposerImages("first")).toBe(2);
    expect(countPreparingComposerImages("second")).toBe(1);
    removePreparingComposerImages("first", new Set(["a", "b"]));
    expect(isPreparingComposerImage("second", "a")).toBe(true);
    removePreparingComposerImages("second", new Set(["a"]));
  });
  it("does not restore an image removed while compression was pending", () => {
    addPreparingComposerImages("cancelled", [image("removed"), image("retained")]);
    expect(removePreparingComposerImages("cancelled", new Set(["removed"]))).toEqual(
      new Set(["removed"]),
    );
    expect(removePreparingComposerImages("cancelled", new Set(["removed", "retained"]))).toEqual(
      new Set(["retained"]),
    );
    expect(countPreparingComposerImages("cancelled")).toBe(0);
  });
});
