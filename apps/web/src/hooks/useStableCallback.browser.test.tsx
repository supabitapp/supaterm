import { useLayoutEffect } from "react";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../test/render";
import { useStableCallback } from "./useStableCallback";

function Child({ value, onLayout }: { value: string; onLayout: (childValue: string) => void }) {
  useLayoutEffect(() => {
    onLayout(value);
  }, [value, onLayout]);
  return null;
}

function Parent({ value, seen }: { value: string; seen: string[] }) {
  const read = useStableCallback((childValue: string) => seen.push(`${childValue}->${value}`));
  return <Child value={value} onLayout={read} />;
}

describe("useStableCallback", () => {
  it("calls the committing render's function from a child layout effect", async () => {
    const seen: string[] = [];
    await using screen = await render(<Parent value="first" seen={seen} />, { router: false });
    await screen.rerender(<Parent value="second" seen={seen} />);
    expect(seen).toEqual(["first->first", "second->second"]);
  });
});
