import { createContext, useContext } from "react";
import type { GuestTransport } from "./guestTransport";

export const GuestTransportContext = createContext<GuestTransport | null>(null);

export function useGuestTransport() {
  const transport = useContext(GuestTransportContext);
  if (!transport) throw new Error("Guest transport is unavailable.");
  return transport;
}
