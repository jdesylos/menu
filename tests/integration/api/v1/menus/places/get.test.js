import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function createPlace(name, { latitude, longitude, hidden = false }) {
  const result = await database.query({
    text: `
      INSERT INTO places
        (source, source_id, name, latitude, longitude, street, hidden_at, hidden_reason)
      VALUES
        ('overture', $1, $1, $2, $3, 'Rua do Teste, 10', $4, $5)
      RETURNING id
    ;`,
    values: [
      name,
      latitude,
      longitude,
      hidden ? new Date() : null,
      hidden ? "closed" : null,
    ],
  });
  return result.rows[0].id;
}

async function sessionForActivatedUser() {
  const created = await orchestrator.createUser();
  const activated = await orchestrator.activateUser(created);
  return await orchestrator.createSession(activated);
}

async function send(placeId, itemNames, sessionObject) {
  const response = await fetch(`${webserver.origin}/api/v1/menus`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `session_id=${sessionObject.token}`,
    },
    body: JSON.stringify({
      place_id: placeId,
      currency: "BRL",
      sections: [
        { title: "Pratos", items: itemNames.map((name) => ({ name })) },
      ],
    }),
  });
  expect(response.status).toBe(201);
  return await response.json();
}

async function list(query = "") {
  const response = await fetch(
    `${webserver.origin}/api/v1/menus/places${query}`,
  );
  return {
    status: response.status,
    cacheControl: response.headers.get("cache-control"),
    body: await response.json(),
  };
}

// A Praça da Sé, e três lugares a distâncias crescentes dela.
const SE = { latitude: -23.5505, longitude: -46.6333 };

describe("GET /api/v1/menus/places", () => {
  describe("Anonymous user", () => {
    test("Without any menu", async () => {
      await createPlace("Bar sem Cardápio", SE);

      const { status, body } = await list();

      expect(status).toBe(200);
      expect(body).toEqual({ places: [] });
    });

    test("With menus near and far", async () => {
      const sessionObject = await sessionForActivatedUser();
      const longe = await createPlace("Bar de Pinheiros", {
        latitude: -23.5673,
        longitude: -46.7019,
      });
      const perto = await createPlace("Bar da Sé", {
        latitude: -23.5507,
        longitude: -46.6335,
      });
      const meio = await createPlace("Bar da Liberdade", {
        latitude: -23.5553,
        longitude: -46.6356,
      });
      // Na ordem em que NÃO devem sair: o que decide é a distância, e não
      // quem mandou primeiro.
      await send(longe, ["Prato longe"], sessionObject);
      await send(meio, ["Prato do meio", "Outro prato"], sessionObject);
      const sent = await send(perto, ["Prato perto"], sessionObject);

      const { status, body, cacheControl } = await list(
        `?lat=${SE.latitude}&lon=${SE.longitude}`,
      );

      expect(status).toBe(200);
      expect(body.places.map((place) => place.name)).toEqual([
        "Bar da Sé",
        "Bar da Liberdade",
        "Bar de Pinheiros",
      ]);
      // O que o mapa já diz do lugar, mais o resumo do cardápio que vale — o
      // cardápio inteiro quem busca é quem toca no lugar.
      expect(body.places[0]).toEqual({
        id: perto,
        name: "Bar da Sé",
        category: null,
        latitude: -23.5507,
        longitude: -46.6335,
        street: "Rua do Teste, 10",
        neighborhood: null,
        locality: null,
        region: null,
        postcode: null,
        menu: { id: sent.id, items: 1, created_at: expect.any(String) },
      });
      expect(body.places[1].menu.items).toBe(2);
      // Quem acabou de mandar espera ver o lugar na lista.
      expect(cacheControl).toContain("no-store");
    });

    // O resumo é o do cardápio que vale: o mais recente.
    test("With a place that received two menus", async () => {
      const sessionObject = await sessionForActivatedUser();
      const placeId = await createPlace("Bar que Mudou", {
        latitude: -23.5,
        longitude: -46.6,
      });
      await send(placeId, ["Antigo"], sessionObject);
      const newest = await send(
        placeId,
        ["Novo", "Novo 2", "Novo 3"],
        sessionObject,
      );

      const { body } = await list();
      const found = body.places.filter((place) => place.id === placeId);

      expect(found).toHaveLength(1);
      expect(found[0].menu.id).toBe(newest.id);
      expect(found[0].menu.items).toBe(3);
    });

    // Sem origem, os mais recentes primeiro.
    test("Without an origin", async () => {
      const { status, body } = await list();

      expect(status).toBe(200);
      expect(body.places[0].name).toBe("Bar que Mudou");
    });

    // O lugar oculto saiu do mapa, e sai da lista junto — o cardápio dele
    // continua guardado.
    test("With a hidden place", async () => {
      const sessionObject = await sessionForActivatedUser();
      const placeId = await createPlace("Bar que Vai Fechar", SE);
      await send(placeId, ["Último prato"], sessionObject);
      await database.query({
        text: `
          UPDATE places
          SET hidden_at = now(), hidden_reason = 'closed'
          WHERE id = $1
        ;`,
        values: [placeId],
      });

      const { body } = await list();

      expect(body.places.map((place) => place.id)).not.toContain(placeId);
    });

    test("With an origin that is not a coordinate", async () => {
      const { status, body } = await list("?lat=abc&lon=-46.6");

      expect(status).toBe(400);
      expect(body.name).toBe("ValidationError");
    });
  });
});
