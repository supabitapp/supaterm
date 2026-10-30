const LISTED_OVERLAY_ROUTES: ReadonlySet<string> = new Set([
  "PullRequestReview",
  "PullRequestInlineComment",
  "Connections",
  "ConnectionsNew",
  "GitBranches",
  "GitCommit",
  "GitConfirm",
  "GitOverview",
  "NewTaskProject",
  "NewTaskFiles",
  "NewTaskFile",
  "NewTaskAttachment",
  "NewTaskThreadSettings",
  "AddProject",
  "AddProjectRepository",
  "AddProjectDestination",
  "AddProjectLocal",
  "AddProjectNew",
  "NewTaskEnvironment",
  "NewTaskBranch",
  "SettingsLegal",
  "ThreadAgents",
  "ThreadBackgroundWork",
  "ThreadPullRequests",
  "ThreadQueue",
  "ThreadReviewComment",
  "ThreadDevicePreview",
  "ThreadBrowserPreview",
  "ThreadSettingsSheet",
  "MermaidDiagram",
]);

let presentedRoutes: ReadonlySet<string> = new Set();

export function registerPresentedRoutes(names: Iterable<string>) {
  presentedRoutes = new Set(names);
}

export function isWorkspaceOverlayRoute(name: string) {
  return LISTED_OVERLAY_ROUTES.has(name) || presentedRoutes.has(name);
}

export function workspaceRoutesOf<Route extends { readonly name: string }>(
  routes: readonly Route[],
) {
  const firstOverlay = routes.findIndex((route) => isWorkspaceOverlayRoute(route.name));
  return {
    workspace: firstOverlay < 0 ? routes : routes.slice(0, firstOverlay),
    overlays: firstOverlay < 0 ? [] : routes.slice(firstOverlay),
  };
}
