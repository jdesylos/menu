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

  describe(".containing()", () => {
    // O Food Storm de Camburi, o caso que pediu esta conta: em produção, é o
    // tile 16/24457/37226 que o traz.
    const FOOD_STORM = { latitude: -23.77546, longitude: -45.64963 };
    // A Praça da Sé, no tile que os testes de integração usam.
    const PRACA_DA_SE = { latitude: -23.5505, longitude: -46.6333 };

    test("with a point whose tile is known", () => {
      expect(tile.containing(FOOD_STORM, 16)).toEqual({
        zoom: 16,
        column: 24457,
        row: 37226,
      });
      expect(tile.containing(PRACA_DA_SE, 16)).toEqual({
        zoom: 16,
        column: 24278,
        row: 37181,
      });
    });

    // É o que importa de verdade: o tile devolvido é um que `bounds` — e por
    // ela a consulta dos lugares — diz que cobre o ponto.
    test("with every zoom the places route accepts", () => {
      for (const point of [FOOD_STORM, PRACA_DA_SE]) {
        for (let zoom = 14; zoom <= 18; zoom++) {
          const { west, east, south, north } = tile.bounds(
            tile.containing(point, zoom),
          );

          expect(point.longitude).toBeGreaterThanOrEqual(west);
          expect(point.longitude).toBeLessThan(east);
          expect(point.latitude).toBeGreaterThan(south);
          expect(point.latitude).toBeLessThanOrEqual(north);
        }
      }
    });

    test("with a point at the edge of the world", () => {
      // No zoom 2 a grade é 4x4: nada pode cair na coluna ou na linha 4.
      expect(tile.containing({ latitude: -89.9, longitude: 180 }, 2)).toEqual({
        zoom: 2,
        column: 3,
        row: 3,
      });
      expect(tile.containing({ latitude: 89.9, longitude: -180 }, 2)).toEqual({
        zoom: 2,
        column: 0,
        row: 0,
      });
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

  describe(".dropUnusedLayers()", () => {
    test("with layers the app does not draw", () => {
      const roads = layer("roads", 40);
      const buildings = layer("buildings", 300);
      const body = Buffer.concat([
        layer("pois", 200),
        roads,
        layer("places", 20),
        buildings,
      ]);

      // O que fica sai byte a byte como entrou, e na mesma ordem.
      expect(tile.dropUnusedLayers(body)).toEqual(
        Buffer.concat([roads, buildings]),
      );
    });

    test("with only layers the app draws", () => {
      const body = Buffer.concat([layer("earth", 10), layer("water", 10)]);

      // O mesmo buffer, sem cópia: não havia o que tirar.
      expect(tile.dropUnusedLayers(body)).toBe(body);
    });

    test("with only layers the app does not draw", () => {
      // Sobra um tile vazio, que a rota responde como 204.
      expect(tile.dropUnusedLayers(layer("pois", 50))).toHaveLength(0);
    });

    test("with a layer whose name is not the first field", () => {
      // O protobuf não promete ordem de campo: aqui a versão (campo 15) vem
      // antes do nome.
      const pois = field(
        3,
        Buffer.concat([varintField(15, 2), field(1, Buffer.from("pois"))]),
      );
      const roads = layer("roads", 40);

      expect(tile.dropUnusedLayers(Buffer.concat([pois, roads]))).toEqual(
        roads,
      );
    });

    test("with a layer without a name", () => {
      const body = field(3, varintField(15, 2));

      expect(tile.dropUnusedLayers(body)).toBe(body);
    });

    test("with a tile cut in the middle", () => {
      const whole = Buffer.concat([layer("pois", 200), layer("roads", 40)]);
      const body = whole.subarray(0, whole.length - 5);

      // Na dúvida o tile vai como veio: cortar mais seria pior.
      expect(tile.dropUnusedLayers(body)).toBe(body);
    });

    test("with bytes that are not a tile", () => {
      const body = Buffer.from("<html>login</html>");

      expect(tile.dropUnusedLayers(body)).toBe(body);
    });

    test("with an empty tile", () => {
      const body = Buffer.alloc(0);

      expect(tile.dropUnusedLayers(body)).toBe(body);
    });
  });
});

// Um tile vetorial montado à mão, só com o que `dropUnusedLayers` lê: camadas
// (campo 3) com nome (campo 1) e um recheio do tamanho pedido no lugar das
// feições (campo 2).
function layer(name, fillerLength) {
  return field(
    3,
    Buffer.concat([
      field(1, Buffer.from(name)),
      field(2, Buffer.alloc(fillerLength, 0x2a)),
      varintField(15, 2),
    ]),
  );
}

// Um campo de tamanho declarado (tipo 2): etiqueta, tamanho, conteúdo.
function field(number, payload) {
  return Buffer.concat([
    varint(number * 8 + 2),
    varint(payload.length),
    payload,
  ]);
}

// Um campo inteiro (tipo 0): etiqueta e valor.
function varintField(number, value) {
  return Buffer.concat([varint(number * 8), varint(value)]);
}

function varint(value) {
  const bytes = [];
  while (value >= 0x80) {
    bytes.push((value % 0x80) + 0x80);
    value = Math.floor(value / 0x80);
  }
  bytes.push(value);
  return Buffer.from(bytes);
}
