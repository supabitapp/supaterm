import { showBootError } from "./lib/bootError";

const load = window.location.pathname === "/guest" ? import("./guestMain") : import("./main");

void load.then(({ startup }) => startup).catch(showBootError);
