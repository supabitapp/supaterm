export type ResponsiveSidebarState = "expanded" | "collapsed";

export function resolveSidebarState(input: {
  isMobile: boolean;
  open: boolean;
  openMobile: boolean;
}): ResponsiveSidebarState;
export function resolveSidebarState(input: {
  isMobile: boolean;
  open: boolean;
  openMobile: boolean;
}) {
  return (
    (input.isMobile ? input.openMobile : input.open) ? "expanded" : "collapsed"
  ) satisfies ResponsiveSidebarState;
}
