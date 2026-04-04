import { describe, expect, test } from "vitest";

import { InputValidationError } from "../src/lib/errors.js";
import { normalizeEmail } from "../src/lib/email.js";

describe("email helpers", () => {
  test("trims and lowercases valid emails", () => {
    expect(normalizeEmail("  Foo.Bar+tag@Example.COM  ")).toBe("foo.bar+tag@example.com");
  });

  test("accepts a double-quoted email label", () => {
    expect(normalizeEmail('"Admin@Northview.jp"')).toBe("admin@northview.jp");
  });

  test("accepts a single-quoted email label", () => {
    expect(normalizeEmail("'Admin@Northview.jp'")).toBe("admin@northview.jp");
  });

  test("throws a typed error for invalid emails", () => {
    expect(() => normalizeEmail("not-an-email")).toThrow(InputValidationError);
  });
});
