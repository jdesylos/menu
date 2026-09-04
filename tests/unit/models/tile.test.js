import tile from "models/tile.js";
import { ValidationError, ServiceError } from "infra/errors.js";

describe("models/tile.js", () => {
  describe(".parseCoordinates()", () => {
    test("with valid coordinates", () => {
      expect(tile.parseCoordinates({ z: "14", x: "6069", y: "9295" })).toEqual({
        zoom: 14,
        column: 6069,
        row: 9295,
      });
    });

    test("with zoom zero", () => {
      expect(tile.parseCoordinates({ z: "0", x: "0", y: "0" })).toEqual({
        zoom: 0,
        column: 0,
        row: 0,
      });
    });

    test("with non-numeric coordinate", () => {
      expect(() => {
        tile.parseCoordinates({ z: "14", x: "abc", y: "9295" });
      }).toThrow(ValidationError);
    });

    test("with negative coordinate", () => {
      expect(() => {
        tile.parseCoordinates({ z: "14", x: "-1", y: "9295" });
      }).toThrow(ValidationError);
    });

    test("with coordinate in scientific notation", () => {
      expect(() => {
        tile.parseCoordinates({ z: "1e2", x: "0", y: "0" });
      }).toThrow(ValidationError);
    });

    test("with zoom above the maximum", () => {
      expect(() => {
        tile.parseCoordinates({ z: "16", x: "0", y: "0" });
      }).toThrow(ValidationError);
    });

    test("with coordinate outside the zoom grid", () => {
      // No zoom 1 a grade é 2x2, então "2" já está fora.
      expect(() => {
        tile.parseCoordinates({ z: "1", x: "2", y: "0" });
      }).toThrow(ValidationError);
    });
  });

  describe(".isWithinServedArea()", () => {
    test("with a tile over São Paulo", () => {
      // z12 sobre a Praça da Sé (-23.5505, -46.6333).
      expect(
        tile.isWithinServedArea({ zoom: 12, column: 1517, row: 2323 }),
      ).toBe(true);
    });

    test("with a tile over Tokyo", () => {
      // z12 sobre Tóquio (35.68, 139.77) — fora da área servida.
      expect(
        tile.isWithinServedArea({ zoom: 12, column: 3638, row: 1612 }),
      ).toBe(false);
    });

    test("with a low zoom tile anywhere", () => {
      // Até o zoom 5 o mundo inteiro passa, para não abrir buraco na borda.
      expect(tile.isWithinServedArea({ zoom: 0, column: 0, row: 0 })).toBe(
        true,
      );
      expect(tile.isWithinServedArea({ zoom: 5, column: 31, row: 31 })).toBe(
        true,
      );
    });
  });

  describe(".fetchVectorTile()", () => {
    test("without PROTOMAPS_API_KEY configured", async () => {
      const originalKey = process.env.PROTOMAPS_API_KEY;
      delete process.env.PROTOMAPS_API_KEY;

      await expect(
        tile.fetchVectorTile({ zoom: 12, column: 1517, row: 2323 }),
      ).rejects.toThrow(ServiceError);

      if (originalKey !== undefined) {
        process.env.PROTOMAPS_API_KEY = originalKey;
      }
    });
  });
});
