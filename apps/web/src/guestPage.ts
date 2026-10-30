export const GUEST_PAGE_PATH = "/guest";

export function isGuestPage(): boolean {
  return window.location.pathname === GUEST_PAGE_PATH;
}
