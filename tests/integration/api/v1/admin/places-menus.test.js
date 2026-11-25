import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import authorization from "models/authorization.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function adminSessionCookie() {
  const user = await orchestrator.createUser();
  await orchestrator.activateUser(user);
  const admin = await orchestrator.addFeaturesToUser(
    user,
    authorization.ADMIN_PANEL_FEATURES,
  );
  const sess = await orchestrator.createSession(admin);
  return `session_id=${sess.token}`;
}

describe("Admin places and menus management", () => {
  test("Creates place, searches by name & address, hides/restores, edits menu, and deletes unused admin place", async () => {
    const cookie = await adminSessionCookie();

    const createRes = await fetch(`${webserver.origin}/api/v1/admin/places`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: "Bistrô da Esquina",
        category: "restaurant",
        street: "Rua Augusta, 500",
        neighborhood: "Consolação",
        locality: "São Paulo",
        region: "SP",
        postcode: "01304-000",
        latitude: -23.5535,
        longitude: -46.6525,
      }),
    });
    expect(createRes.status).toBe(201);
    const createdPlace = await createRes.json();

    // Busca por endereço sem acento funciona igual à busca por nome.
    const byAddressRes = await fetch(
      `${webserver.origin}/api/v1/admin/places?q=consolacao`,
      { headers: { Cookie: cookie } },
    );
    expect(byAddressRes.status).toBe(200);
    const byAddressBody = await byAddressRes.json();
    expect(byAddressBody.items.some((p) => p.id === createdPlace.id)).toBe(
      true,
    );

    const hideRes = await fetch(
      `${webserver.origin}/api/v1/admin/places/${createdPlace.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ action: "hide", reason: "admin_removed" }),
      },
    );
    expect(hideRes.status).toBe(200);
    expect((await hideRes.json()).hidden_reason).toBe("admin_removed");

    const hiddenSearchRes = await fetch(
      `${webserver.origin}/api/v1/admin/places?visibility=hidden&q=bistro`,
      { headers: { Cookie: cookie } },
    );
    const hiddenSearch = await hiddenSearchRes.json();
    expect(hiddenSearch.items.some((p) => p.id === createdPlace.id)).toBe(true);

    const restoreRes = await fetch(
      `${webserver.origin}/api/v1/admin/places/${createdPlace.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ action: "restore" }),
      },
    );
    expect(restoreRes.status).toBe(200);
    expect((await restoreRes.json()).hidden_at).toBeNull();

    // Cria e edita cardápio pelo painel sem restrição de GPS.
    const menuCreateRes = await fetch(
      `${webserver.origin}/api/v1/admin/menus/${createdPlace.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          currency: "BRL",
          sections: [
            {
              title: "Pratos",
              items: [
                { name: "Risoto", ingredients: "Cogumelos", price_cents: 6200 },
              ],
            },
          ],
        }),
      },
    );
    expect(menuCreateRes.status).toBe(200);
    const firstMenu = await menuCreateRes.json();

    const menuUpdateRes = await fetch(
      `${webserver.origin}/api/v1/admin/menus/${createdPlace.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          currency: "BRL",
          replaces: firstMenu.id,
          sections: [
            {
              title: "Pratos",
              items: [
                {
                  id: firstMenu.sections[0].items[0].id,
                  name: "Risoto Especial",
                  price_cents: 6800,
                },
                { name: "Suco natural", price_cents: 1400 },
              ],
            },
          ],
        }),
      },
    );
    expect(menuUpdateRes.status).toBe(200);
    const secondMenu = await menuUpdateRes.json();
    expect(secondMenu.sections[0].items).toHaveLength(2);

    // Local com cardápio não pode ser excluído fisicamente.
    const refusedDelete = await fetch(
      `${webserver.origin}/api/v1/admin/places/${createdPlace.id}`,
      { method: "DELETE", headers: { Cookie: cookie } },
    );
    expect(refusedDelete.status).toBe(409);

    // Local recém-criado no painel sem cardápio pode ser excluído fisicamente.
    const unusedPlaceRes = await fetch(
      `${webserver.origin}/api/v1/admin/places`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          name: "Local Rascunho",
          latitude: -23.5505,
          longitude: -46.6333,
        }),
      },
    );
    const unused = await unusedPlaceRes.json();

    // Config e viewport do mapa administrativo (locais com/sem cardápio e ocultos).
    const mapConfigRes = await fetch(
      `${webserver.origin}/api/v1/admin/places?mode=config`,
      { headers: { Cookie: cookie } },
    );
    expect(mapConfigRes.status).toBe(200);
    const mapConfig = await mapConfigRes.json();
    expect(typeof mapConfig.vector_tiles).toBe("boolean");

    const anonViewportRes = await fetch(
      `${webserver.origin}/api/v1/admin/places?mode=viewport&south=-23.555&north=-23.545&west=-46.638&east=-46.628`,
    );
    expect(anonViewportRes.status).toBe(403);

    const oversizedViewportRes = await fetch(
      `${webserver.origin}/api/v1/admin/places?mode=viewport&south=-23.7&north=-23.4&west=-46.7&east=-46.4`,
      { headers: { Cookie: cookie } },
    );
    expect(oversizedViewportRes.status).toBe(400);

    const hiddenPlaceRes = await fetch(
      `${webserver.origin}/api/v1/admin/places`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          name: "Local Oculto Viewport",
          latitude: -23.5509,
          longitude: -46.6331,
        }),
      },
    );
    expect(hiddenPlaceRes.status).toBe(201);
    const hiddenPlace = await hiddenPlaceRes.json();

    const hideViewportPlaceRes = await fetch(
      `${webserver.origin}/api/v1/admin/places/${hiddenPlace.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ action: "hide", reason: "admin_removed" }),
      },
    );
    expect(hideViewportPlaceRes.status).toBe(200);

    const viewportRes = await fetch(
      `${webserver.origin}/api/v1/admin/places?mode=viewport&south=-23.555&north=-23.545&west=-46.638&east=-46.628`,
      { headers: { Cookie: cookie } },
    );
    expect(viewportRes.status).toBe(200);
    const viewportBody = await viewportRes.json();
    expect(typeof viewportBody.vector_tiles).toBe("boolean");
    const unusedInViewport = viewportBody.places.find(
      (item) => item.id === unused.id,
    );
    const hiddenInViewport = viewportBody.places.find(
      (item) => item.id === hiddenPlace.id,
    );
    expect(unusedInViewport).toMatchObject({
      id: unused.id,
      has_menu: false,
      hidden_at: null,
    });
    expect(hiddenInViewport).toMatchObject({
      id: hiddenPlace.id,
      has_menu: false,
      hidden_reason: "admin_removed",
    });
    expect(hiddenInViewport.hidden_at).toEqual(expect.any(String));

    const createdLat = Number(createdPlace.latitude);
    const createdLng = Number(createdPlace.longitude);
    const menuViewportRes = await fetch(
      `${webserver.origin}/api/v1/admin/places?mode=viewport&south=${createdLat - 0.005}&north=${createdLat + 0.005}&west=${createdLng - 0.005}&east=${createdLng + 0.005}`,
      { headers: { Cookie: cookie } },
    );
    expect(menuViewportRes.status).toBe(200);
    const menuViewportBody = await menuViewportRes.json();
    const createdInViewport = menuViewportBody.places.find(
      (item) => item.id === createdPlace.id,
    );
    expect(createdInViewport).toMatchObject({
      id: createdPlace.id,
      has_menu: true,
    });

    const okDelete = await fetch(
      `${webserver.origin}/api/v1/admin/places/${unused.id}`,
      { method: "DELETE", headers: { Cookie: cookie } },
    );
    expect(okDelete.status).toBe(200);
  });
});
