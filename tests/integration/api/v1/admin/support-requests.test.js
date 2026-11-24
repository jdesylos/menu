import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";
import authorization from "models/authorization.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function createAdminCookie() {
  const created = await orchestrator.activateUser(
    await orchestrator.createUser(),
  );
  const admin = await orchestrator.addFeaturesToUser(
    created,
    authorization.ADMIN_PANEL_FEATURES,
  );
  const sess = await orchestrator.createSession(admin);
  return { admin, cookie: `session_id=${sess.token}` };
}

describe("Admin support requests queue & place creation flow", () => {
  test("Non-admin receives 403; admin filters, links created place, resolves request and writes audit log", async () => {
    const regularUser = await orchestrator.activateUser(
      await orchestrator.createUser(),
    );
    const regularSess = await orchestrator.createSession(regularUser);

    const forbiddenRes = await fetch(
      `${webserver.origin}/api/v1/admin/support-requests`,
      { headers: { Cookie: `session_id=${regularSess.token}` } },
    );
    expect(forbiddenRes.status).toBe(403);

    // Submete pedido de novo local e ajuda de conta.
    const reqMissing = await fetch(
      `${webserver.origin}/api/v1/support/requests`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "missing_place",
          place_name: "Padaria Nova Esperança",
          approximate_address: "Av. Paulista perto da Consolação",
          latitude: -23.5561,
          longitude: -46.6621,
          contact_email: "cliente@menuspoiler.com.br",
        }),
      },
    );
    expect(reqMissing.status).toBe(201);
    const missingId = (await reqMissing.json()).request.id;

    const reqAccount = await fetch(
      `${webserver.origin}/api/v1/support/requests`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "account_help",
          contact_email: "semacesso@menuspoiler.com.br",
          account_identifier: "joao99",
          message: "Não recebo e-mail de confirmação",
        }),
      },
    );
    expect(reqAccount.status).toBe(201);

    const { admin, cookie } = await createAdminCookie();

    // Admin filtra por categoria.
    const filterMissing = await fetch(
      `${webserver.origin}/api/v1/admin/support-requests?category=missing_place&status=open`,
      { headers: { Cookie: cookie } },
    );
    expect(filterMissing.status).toBe(200);
    const filterMissingBody = await filterMissing.json();
    expect(filterMissingBody.total).toBe(1);
    expect(filterMissingBody.counts.open).toBe(2);
    expect(filterMissingBody.items[0].id).toBe(missingId);
    expect(filterMissingBody.items[0].approximate_address).toContain(
      "Paulista",
    );

    // Admin cadastra o local e resolve a solicitação vinculada.
    const createPlaceRes = await fetch(
      `${webserver.origin}/api/v1/admin/places`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          name: "Padaria Nova Esperança",
          street: "Av. Paulista, 2400",
          locality: "São Paulo",
          region: "SP",
          latitude: -23.5561,
          longitude: -46.6621,
        }),
      },
    );
    expect(createPlaceRes.status).toBe(201);
    const createdPlace = await createPlaceRes.json();

    const patchRes = await fetch(
      `${webserver.origin}/api/v1/admin/support-requests/${missingId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          status: "resolved",
          resolved_place_id: createdPlace.id,
          resolution_note: "Local cadastrado no painel.",
        }),
      },
    );
    expect(patchRes.status).toBe(200);
    const patchedBody = await patchRes.json();
    expect(patchedBody.status).toBe("resolved");
    expect(patchedBody.resolved_place_id).toBe(createdPlace.id);
    expect(patchedBody.resolved_place_name).toBe("Padaria Nova Esperança");
    expect(patchedBody.handled_by).toBe(admin.id);
    expect(patchedBody.resolved_at).toBeTruthy();

    const auditRes = await database.query({
      text: "SELECT action, metadata FROM audit_logs WHERE action = 'admin.support_request.updated' AND actor_user_id = $1;",
      values: [admin.id],
    });
    expect(auditRes.rowCount).toBe(1);
    expect(auditRes.rows[0].metadata.to_status).toBe("resolved");
    expect(auditRes.rows[0].metadata.resolved_place_id).toBe(createdPlace.id);
  });
});
