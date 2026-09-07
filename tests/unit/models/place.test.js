import place from "models/place.js";
import { ValidationError } from "infra/errors.js";

describe("models/place.js", () => {
  describe(".parseCoordinates()", () => {
    test("with valid coordinates", () => {
      expect(
        place.parseCoordinates({ z: "16", x: "24278", y: "37181" }),
      ).toEqual({
        zoom: 16,
        column: 24278,
        row: 37181,
      });
    });

    test("at the minimum zoom", () => {
      expect(place.parseCoordinates({ z: "14", x: "6069", y: "9295" })).toEqual(
        {
          zoom: 14,
          column: 6069,
          row: 9295,
        },
      );
    });

    // Abaixo de 14 um tile cobre uma cidade: a resposta seria de milhares de
    // lugares que ninguém consegue desenhar.
    test("with a zoom below the minimum", () => {
      expect(() => {
        place.parseCoordinates({ z: "13", x: "0", y: "0" });
      }).toThrow(ValidationError);
    });

    // O basemap para em 15, mas estabelecimento não: pedir place em 16 é o uso
    // normal do aplicativo, e a validação do tile não pode valer aqui.
    test("with a zoom above the basemap maximum but valid here", () => {
      expect(place.parseCoordinates({ z: "18", x: "0", y: "0" })).toEqual({
        zoom: 18,
        column: 0,
        row: 0,
      });
    });

    test("with a zoom above the maximum", () => {
      expect(() => {
        place.parseCoordinates({ z: "19", x: "0", y: "0" });
      }).toThrow(ValidationError);
    });

    test("with a non-numeric coordinate", () => {
      expect(() => {
        place.parseCoordinates({ z: "16", x: "abc", y: "0" });
      }).toThrow(ValidationError);
    });

    test("with a coordinate outside the zoom grid", () => {
      expect(() => {
        place.parseCoordinates({ z: "14", x: "16384", y: "0" });
      }).toThrow(ValidationError);
    });
  });
});
