import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
});

// Nenhum teste aqui chama a Protomaps: os casos cobertos são os que a rota
// resolve sozinha (validação e recorte de área). O caminho que sai para a
// internet fica fora da suíte de propósito — teste que depende de serviço de
// terceiro falha por motivo alheio ao código.
describe("GET /api/v1/tiles/[z]/[x]/[y]", () => {
  describe("Anonymous user", () => {
    test("With a non-numeric coordinate", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/tiles/12/abc/2323`,
      );
      expect(response.status).toBe(400);

      const responseBody = await response.json();
      expect(responseBody.name).toBe("ValidationError");
      expect(responseBody.status_code).toBe(400);
    });

    test("With a zoom above the maximum", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/tiles/16/0/0`);
      expect(response.status).toBe(400);

      const responseBody = await response.json();
      expect(responseBody.name).toBe("ValidationError");
    });

    test("With a coordinate outside the zoom grid", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/tiles/1/2/0`);
      expect(response.status).toBe(400);

      const responseBody = await response.json();
      expect(responseBody.name).toBe("ValidationError");
    });

    test("With a tile outside the served area", async () => {
      // Tóquio: fora do recorte, então volta vazio em vez de gastar cota.
      const response = await fetch(
        `${webserver.origin}/api/v1/tiles/12/3638/1612`,
      );
      expect(response.status).toBe(204);
      expect(response.headers.get("content-type")).toBe(
        "application/vnd.mapbox-vector-tile",
      );
      expect(response.headers.get("cache-control")).toContain("s-maxage");
    });

    test("With an unsupported method", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/tiles/12/1517/2323`,
        { method: "POST" },
      );
      expect(response.status).toBe(405);

      const responseBody = await response.json();
      expect(responseBody.name).toBe("MethodNotAllowedError");
    });
  });
});
