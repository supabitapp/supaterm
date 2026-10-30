import { showBootError } from "./lib/bootError";

import { isGuestPage } from "./guestPage";

const load = isGuestPage() ? import("./guestMain") : import("./main");

void load.then(({ startup }) => startup).catch(showBootError);
