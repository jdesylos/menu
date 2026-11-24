import {
  centsToInput,
  formatPriceCents,
  formatShortDate,
  hasFeature,
  parsePriceToCents,
} from "lib/adminApi.js";

describe("lib/adminApi.js", () => {
  test("centsToInput formats integer cents to pt-BR decimal text", () => {
    expect(centsToInput(4200)).toBe("42,00");
    expect(centsToInput(5)).toBe("0,05");
    expect(centsToInput(null)).toBe("");
    expect(centsToInput(undefined)).toBe("");
  });

  test("parsePriceToCents parses valid numeric prices and rejects invalid strings", () => {
    expect(parsePriceToCents("42,50")).toBe(4250);
    expect(parsePriceToCents("R$ 12.90")).toBe(1290);
    expect(parsePriceToCents("0")).toBe(0);
    expect(parsePriceToCents("   ")).toBeNull();
    expect(Number.isNaN(parsePriceToCents("abc"))).toBe(true);
    expect(Number.isNaN(parsePriceToCents("-5"))).toBe(true);
  });

  test("formatPriceCents formats currencies and null prices cleanly", () => {
    expect(formatPriceCents(4200, "BRL")).toBe("R$ 42,00");
    expect(formatPriceCents(1500, "USD")).toBe("US$ 15,00");
    expect(formatPriceCents(990, "EUR")).toBe("€ 9,90");
    expect(formatPriceCents(null)).toBe("Sem preço");
  });

  test("hasFeature checks user feature array safely", () => {
    expect(
      hasFeature({ features: ["admin", "manage:menu"] }, "manage:menu"),
    ).toBe(true);
    expect(hasFeature({ features: ["admin"] }, "manage:menu")).toBe(false);
    expect(hasFeature(null, "admin")).toBe(false);
  });

  test("formatShortDate formats compact tabular pt-BR dates", () => {
    expect(formatShortDate("2026-11-24T15:30:00.000Z")).toMatch(
      /^\d{2}\/\d{2}\/\d{2}$/,
    );
    expect(formatShortDate(null)).toBe("—");
    expect(formatShortDate("invalid")).toBe("—");
  });
});
