import { describe, expect, it } from "vite-plus/test";

import { keepOrder, withArrivedKeys } from "./useOrderWhileOpen";

describe("keepOrder", () => {
  it("keeps the opening order and puts new items after it", () => {
    const key = (item: string) => item;
    expect(keepOrder(["c", "d", "a"], ["a", "b", "c"], key)).toEqual(["a", "c", "d"]);
    expect(keepOrder(["c", "a"], null, key)).toEqual(["c", "a"]);
  });

  it("holds rows that arrived after opening in their first place", () => {
    const order = withArrivedKeys(null, ["b", "c"]);
    expect(order).toEqual(["b", "c"]);
    expect(keepOrder(["c", "b"], order, (item) => item)).toEqual(["b", "c"]);
    expect(withArrivedKeys(order, ["b", "c"])).toBe(order);
  });
});
