import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

// O tile 16/24278/37181 cobre a Praça da Sé — é onde os estabelecimentos deste
// teste são plantados.
const TILE_DA_SE = "16/24278/37181";

describe("GET /api/v1/places/[z]/[x]/[y]", () => {
  describe("Anonymous user", () => {
    test("With a zoom below the minimum", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/places/13/0/0`);
      expect(response.status).toBe(400);

      const responseBody = await response.json();
      expect(responseBody.name).toBe("ValidationError");
      expect(responseBody.status_code).toBe(400);
    });

    test("With a zoom above the maximum", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/places/19/0/0`);
      expect(response.status).toBe(400);

      const responseBody = await response.json();
      expect(responseBody.name).toBe("ValidationError");
    });

    test("With a non-numeric coordinate", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/places/16/abc/37181`,
      );
      expect(response.status).toBe(400);

      const responseBody = await response.json();
      expect(responseBody.name).toBe("ValidationError");
    });

    test("With an empty tile", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/places/${TILE_DA_SE}`,
      );
      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody).toEqual({ places: [] });
    });

    test("With places inside and outside the tile", async () => {
      await createPlace({
        sourceId: "dentro-1",
        name: "Bar do Teste",
        category: "bar",
        latitude: -23.5505,
        longitude: -46.6333,
      });
      // Rio de Janeiro: mesmo país, outro tile — não pode vir na resposta.
      await createPlace({
        sourceId: "fora-1",
        name: "Boteco Distante",
        category: "bar",
        latitude: -22.9068,
        longitude: -43.1729,
      });

      const response = await fetch(
        `${webserver.origin}/api/v1/places/${TILE_DA_SE}`,
      );
      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody.places).toEqual([
        {
          name: "Bar do Teste",
          category: "bar",
          latitude: -23.5505,
          longitude: -46.6333,
        },
      ]);
    });

    // O mapa não pode depender de quem está olhando: uma sessão vencida não
    // pode fazer os restaurantes sumirem da tela.
    test("With cache headers for the CDN", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/places/${TILE_DA_SE}`,
      );

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("s-maxage");
    });
  });
});

async function createPlace({ sourceId, name, category, latitude, longitude }) {
  await database.query({
    text: `
      INSERT INTO
        places (source, source_id, name, category, latitude, longitude)
      VALUES
        ($1, $2, $3, $4, $5, $6)
    ;`,
    values: ["overture", sourceId, name, category, latitude, longitude],
  });
}
