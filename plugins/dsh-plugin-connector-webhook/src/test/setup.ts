import "@testing-library/jest-dom/vitest";
import {
  hasPlatform,
  setPlatform,
  type PlatformAdapter,
} from "@amiba/app-runtime/platform";
if (!hasPlatform()) {
  const storage = {
    get: async () => ({}),
    set: async () => {},
    remove: async () => {},
    watch: () => () => {},
  };
  setPlatform({ storage } as unknown as PlatformAdapter);
}
