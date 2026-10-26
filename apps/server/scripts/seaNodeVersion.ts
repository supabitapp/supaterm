// The exact Node every CLI single-executable embeds: exact because cross-target
// builds download it from nodejs.org/dist, where only exact versions exist.
// Development, CI, and the desktop backend stay on the mise Node, which matches
// the runtime Electron ships.
export const SEA_NODE_VERSION = "26.12.1";
