import { webcrypto } from "node:crypto";

// Cursor SDK expects Web Crypto on globalThis (unreliable on Node 18).
if (typeof globalThis.crypto === "undefined") {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    enumerable: false,
    configurable: true,
    writable: true,
  });
}
