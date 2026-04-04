import { describe, expect, it } from "vitest";

import { shouldUseBunPtyAdapter } from "./server";

describe("shouldUseBunPtyAdapter", () => {
  it("uses the Bun PTY adapter when running under Bun on non-Windows platforms", () => {
    expect(shouldUseBunPtyAdapter({ hasBun: true, platform: "linux" })).toBe(true);
    expect(shouldUseBunPtyAdapter({ hasBun: true, platform: "darwin" })).toBe(true);
  });

  it("falls back to the Node PTY adapter on Windows even when Bun is present", () => {
    expect(shouldUseBunPtyAdapter({ hasBun: true, platform: "win32" })).toBe(false);
  });

  it("falls back to the Node PTY adapter when Bun is unavailable", () => {
    expect(shouldUseBunPtyAdapter({ hasBun: false, platform: "linux" })).toBe(false);
  });
});
