import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type InputProps = {
  accessibilityLabel: string;
  onChangeText: (text: string) => void;
  onEndEditing: () => void;
};

const inputs = vi.hoisted(() => new Map<string, InputProps>());

vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../../../components/ui/AppText", () => ({
  AppText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  AppTextInput: (props: InputProps) => {
    inputs.set(props.accessibilityLabel, props);
    return null;
  },
}));
vi.mock("./SettingsSection", () => ({
  SettingsSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import { ThreadTitleInstructionsSettings } from "./ThreadTitleInstructionsSettings";

let root: Root;
const onChange = vi.fn();

function render(instructions: string | null) {
  act(() =>
    root.render(
      <ThreadTitleInstructionsSettings
        instructions={instructions}
        disabled={false}
        onChange={onChange}
      />,
    ),
  );
}

function input() {
  const props = inputs.get("Thread title instructions");
  if (!props) throw new Error("Thread title instructions input not rendered");
  return props;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.createElement("div"));
  inputs.clear();
  onChange.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
});

describe("ThreadTitleInstructionsSettings", () => {
  it("saves changed instructions when editing ends", () => {
    render("Lead with the subject.");
    act(() => input().onChangeText(" Lead with the subject. "));
    act(() => input().onEndEditing());
    expect(onChange).not.toHaveBeenCalled();

    act(() => input().onChangeText("  Name the feature first.  "));
    act(() => input().onEndEditing());
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      threadTitleInstructions: "Name the feature first.",
    });
  });

  it("saves typed instructions when the screen closes before editing ends", () => {
    render(null);
    act(() => input().onChangeText("Name the feature first."));
    act(() => root.unmount());
    root = createRoot(document.createElement("div"));

    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      threadTitleInstructions: "Name the feature first.",
    });
  });
});
