import { EnvironmentId } from "@supaterm/contracts";
import { useRef } from "react";
import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { TextFieldVoiceInput } from "./TextFieldVoiceInput";

const voice = vi.hoisted(() => ({ cancel: vi.fn() }));

vi.mock("~/voice/useComposerVoiceInput", () => ({
  useComposerVoiceInput: () => ({
    availability: {
      canReview: true,
      canSend: false,
      label: "Claude · English",
      unavailableReason: null,
      opensSettings: false,
    },
    state: { phase: "recording", error: null, errorAction: null },
    recorder: { elapsedMs: 0, setLevelListener: () => undefined },
    busy: true,
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(),
    cancel: voice.cancel,
    toggle: vi.fn(),
  }),
}));

function Field(props: { readonly hidden: boolean }) {
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  return (
    <div hidden={props.hidden}>
      <textarea ref={fieldRef} aria-label="Comment" />
      <TextFieldVoiceInput
        environmentId={EnvironmentId.make("environment-1")}
        fieldRef={fieldRef}
        onChange={() => undefined}
        onBusyChange={() => undefined}
      />
    </div>
  );
}

describe("TextFieldVoiceInput", () => {
  it("stops recording once its field is hidden, as a closed popover keeps the form mounted", async () => {
    voice.cancel.mockClear();
    await using screen = await render(<Field hidden={false} />);
    await expect.element(screen.getByRole("group", { name: "Voice input" })).toBeInTheDocument();
    expect(voice.cancel).not.toHaveBeenCalled();

    await screen.rerender(<Field hidden />);

    await vi.waitFor(() => expect(voice.cancel).toHaveBeenCalledOnce());
  });
});
