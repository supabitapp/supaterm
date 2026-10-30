import { createContext } from "react";

export const HostImageUrlContext = createContext<((path: string) => string) | null>(null);
