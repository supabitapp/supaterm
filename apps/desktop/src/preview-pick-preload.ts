import { PRIMARY_PASTE_DISABLED_ARGUMENT } from "./preview/GuestProtocol.ts";
import "./preview/PickPreload.ts";

if (process.argv.includes(PRIMARY_PASTE_DISABLED_ARGUMENT)) {
  window.addEventListener(
    "mouseup",
    (event) => {
      if (event.button === 1) event.preventDefault();
    },
    true,
  );
}
