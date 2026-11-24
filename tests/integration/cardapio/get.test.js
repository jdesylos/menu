import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function createPlace({ name, hidden = false }) {
  const result = await database.query({
    text: `
      INSERT INTO places (
        source, source_id, name, latitude, longitude, hidden_at, hidden_reason
      )
      VALUES (
        'overture', $1, $1, -23.5505, -46.6333,
        CASE WHEN $2 THEN timezone('utc', now()) ELSE NULL END,
        CASE WHEN $2 THEN 'reported_closed' ELSE NULL END
      )
      RETURNING id
    ;`,
    values: [name, hidden],
  });
  return result.rows[0].id;
}

describe("GET /cardapio/[place_id]", () => {
  describe("Anonymous user", () => {
    test("Shows the place name and store links without rendering menu items on web", async () => {
      const placeId = await createPlace({ name: "Padaria Central" });
      const createdUser = await orchestrator.createUser();
      await orchestrator.insertMenu({
        placeId,
        userId: createdUser.id,
        itemNames: ["Prato Secreto Exclusivo"],
        createdAt: new Date(),
      });

      const response = await fetch(`${webserver.origin}/cardapio/${placeId}`);
      const html = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("vercel-cache-tag")).toBe(
        `place-share-${placeId}`,
      );
      expect(html).toContain("Padaria Central");
      expect(html).toContain("Padaria Central — Menu Spoiler</title>");
      expect(html).toContain(
        'href="https://apps.apple.com/br/app/menu-spoiler/id6825827914"',
      );
      expect(html).toContain(
        'href="https://play.google.com/store/apps/details?id=com.menuspoiler.app"',
      );
      expect(html).not.toContain("Prato Secreto Exclusivo");
    });

    test("Returns 404 with store links for a hidden place", async () => {
      const hiddenPlaceId = await createPlace({
        name: "Restaurante Oculto",
        hidden: true,
      });

      const response = await fetch(
        `${webserver.origin}/cardapio/${hiddenPlaceId}`,
      );
      const html = await response.text();

      expect(response.status).toBe(404);
      expect(html).not.toContain("Restaurante Oculto");
      expect(html).toContain("Este lugar não está mais disponível");
      expect(html).toContain(
        'href="https://apps.apple.com/br/app/menu-spoiler/id6825827914"',
      );
      expect(html).toContain(
        'href="https://play.google.com/store/apps/details?id=com.menuspoiler.app"',
      );
    });

    test("Returns 404 with store links for an invalid or unknown place id", async () => {
      const response = await fetch(
        `${webserver.origin}/cardapio/nao-e-um-uuid`,
      );
      const html = await response.text();

      expect(response.status).toBe(404);
      expect(html).toContain("Este lugar não está mais disponível");
      expect(html).toContain(
        'href="https://apps.apple.com/br/app/menu-spoiler/id6825827914"',
      );
    });
  });
});
