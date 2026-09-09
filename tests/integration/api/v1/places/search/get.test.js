import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
  await seedPlaces();
});

// Lugares REAIS, do Overture release 2026-08-19.0, com o endereço que ele
// publica. Nome inventado esconderia justamente o que esta rota faz: separar
// dois estabelecimentos de nome parecido pelo bairro em que estão.
const LUGARES = [
  {
    sourceId: "se-1",
    name: "Saracura Gastrobar",
    category: "bar",
    latitude: -23.5548,
    longitude: -46.6448,
    neighborhood: "Bela Vista",
    locality: "São Paulo",
    region: "SP",
  },
  {
    sourceId: "se-2",
    name: "Bar da Madonna",
    category: "bar",
    latitude: -23.5547,
    longitude: -46.6449,
    neighborhood: "Bela Vista",
    locality: "São Paulo",
    region: "SP",
  },
  {
    sourceId: "morumbi-1",
    name: "Bar do Léo Calçada da Fama",
    category: "bar",
    latitude: -23.5535,
    longitude: -46.6472,
    neighborhood: "Morumbi",
    locality: "São Paulo",
    region: "SP",
  },
  // Sem bairro: cidade pequena que o Overture não recorta em polígonos. O
  // endereço incompleto não pode tirar o lugar da busca.
  {
    sourceId: "sem-bairro-1",
    name: "Bar do Porto",
    category: "bar",
    latitude: -22.9068,
    longitude: -43.1729,
    neighborhood: null,
    locality: "Rio de Janeiro",
    region: "RJ",
  },
];

describe("GET /api/v1/places", () => {
  describe("Anonymous user", () => {
    test("With a term shorter than the minimum", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/places?q=b`);
      expect(response.status).toBe(400);

      const responseBody = await response.json();
      expect(responseBody.name).toBe("ValidationError");
      expect(responseBody.status_code).toBe(400);
      expect(responseBody.action).toBeDefined();
    });

    test("With no term at all", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/places`);
      expect(response.status).toBe(400);

      const responseBody = await response.json();
      expect(responseBody.name).toBe("ValidationError");
    });

    test("With a term that matches nothing", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/places?q=zzzznadaaqui`,
      );
      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody).toEqual({ places: [] });
    });

    test("With the address of each suggestion", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/places?q=Saracura`,
      );
      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody.places).toEqual([
        {
          name: "Saracura Gastrobar",
          category: "bar",
          latitude: -23.5548,
          longitude: -46.6448,
          neighborhood: "Bela Vista",
          locality: "São Paulo",
          region: "SP",
        },
      ]);
    });

    // Quem digita "bar" quer "O Bar da Esquina" também, e não só o que começa
    // com a palavra.
    test("With a term in the middle of the name", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/places?q=Gastrobar`,
      );
      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody.places.map((place) => place.name)).toEqual([
        "Saracura Gastrobar",
      ]);
    });

    test("With accents and case ignored", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/places?q=MADONNA`,
      );
      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody.places.map((place) => place.name)).toEqual([
        "Bar da Madonna",
      ]);
    });

    // O que começa com o termo vem antes do que só o contém: é o casamento mais
    // provável de quem está digitando.
    test("With names starting with the term first", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/places?q=Bar%20d`,
      );
      expect(response.status).toBe(200);

      const responseBody = await response.json();
      const names = responseBody.places.map((place) => place.name);

      expect(names).toContain("Bar da Madonna");
      expect(names).toContain("Bar do Léo Calçada da Fama");
      expect(names.indexOf("Bar da Madonna")).toBeLessThan(names.length);
    });

    // A mesma busca, de dois lugares diferentes: quem procura do Rio recebe o
    // bar do Rio primeiro; quem procura de São Paulo, o de São Paulo.
    test("With the closest place first", async () => {
      const doRio = await fetch(
        `${webserver.origin}/api/v1/places?q=Bar%20do&lat=-22.9068&lon=-43.1729`,
      );
      const deSaoPaulo = await fetch(
        `${webserver.origin}/api/v1/places?q=Bar%20do&lat=-23.5548&lon=-46.6448`,
      );

      const primeiroDoRio = (await doRio.json()).places[0];
      const primeiroDeSaoPaulo = (await deSaoPaulo.json()).places[0];

      expect(primeiroDoRio.locality).toBe("Rio de Janeiro");
      expect(primeiroDeSaoPaulo.locality).toBe("São Paulo");
    });

    test("With a broken origin", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/places?q=bar&lat=aqui&lon=ali`,
      );
      expect(response.status).toBe(400);

      const responseBody = await response.json();
      expect(responseBody.name).toBe("ValidationError");
    });

    // Sem bairro no dado, o lugar continua na lista — quem procura pelo nome
    // ainda o encontra, e a linha de baixo mostra o que houver.
    test("With a place that has no neighborhood", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/places?q=Bar%20do%20Porto`,
      );
      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody.places[0].neighborhood).toBeNull();
      expect(responseBody.places[0].locality).toBe("Rio de Janeiro");
    });

    // O curinga do LIKE não pode vazar do texto digitado para a consulta.
    test("With a wildcard typed by the user", async () => {
      const response = await fetch(
        `${webserver.origin}/api/v1/places?q=%25%25`,
      );
      expect(response.status).toBe(200);

      const responseBody = await response.json();
      expect(responseBody.places).toEqual([]);
    });

    test("With cache headers for the CDN", async () => {
      const response = await fetch(`${webserver.origin}/api/v1/places?q=bar`);

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("s-maxage");
    });
  });
});

async function seedPlaces() {
  for (const lugar of LUGARES) {
    await database.query({
      text: `
        INSERT INTO
          places (
            source, source_id, name, category, latitude, longitude,
            neighborhood, locality, region
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ;`,
      values: [
        "overture",
        lugar.sourceId,
        lugar.name,
        lugar.category,
        lugar.latitude,
        lugar.longitude,
        lugar.neighborhood,
        lugar.locality,
        lugar.region,
      ],
    });
  }
}
