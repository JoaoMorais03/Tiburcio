// __tests__/setup.ts — Global test setup: MSW server, jest-dom matchers, localStorage polyfill.

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/vue";
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./mocks/handlers";

// Node.js 25 ships a built-in localStorage that is NOT Web Storage API compliant
// (plain object, no setItem/getItem). Replace it with a proper mock.
const store = new Map<string, string>();
const storageMock: Storage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
  get length() {
    return store.size;
  },
  key: (index: number) => [...store.keys()][index] ?? null,
};
Object.defineProperty(globalThis, "localStorage", { value: storageMock, writable: true });

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
  store.clear();
});
afterAll(() => server.close());
