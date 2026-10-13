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

  describe(".cacheTag()", () => {
    test("with the coordinates of a tile", () => {
      expect(place.cacheTag({ zoom: 16, column: 24457, row: 37226 })).toBe(
        "places-16-24457-37226",
      );
    });
  });

  describe(".cacheTagsOf()", () => {
    // Um tile por zoom que a rota aceita, e nenhum a mais: o que ficar de
    // fora segue na borda com o dado velho.
    test("with a place", () => {
      // O Food Storm de Camburi.
      const tags = place.cacheTagsOf({
        latitude: -23.77546,
        longitude: -45.64963,
      });

      expect(tags).toEqual([
        "places-14-6114-9306",
        "places-15-12228-18613",
        "places-16-24457-37226",
        "places-17-48915-74452",
        "places-18-97830-148904",
      ]);
    });

    // As duas contas têm de dar o mesmo nome ao mesmo tile: a etiqueta que a
    // rota escreve é a que o cardápio novo apaga.
    test("with the tile the route would tag", () => {
      const coordinates = place.parseCoordinates({
        z: "16",
        x: "24278",
        y: "37181",
      });

      // A Praça da Sé, que fica nesse tile.
      expect(
        place.cacheTagsOf({ latitude: -23.5505, longitude: -46.6333 }),
      ).toContain(place.cacheTag(coordinates));
    });
  });
});
