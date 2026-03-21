/// <reference types="vite/client" />

declare module "*.css" {
  const content: string;
  export default content;
}

/** Server URL injected by Vite define. Empty string means same-origin. */
declare const __SERVER_URL__: string;
