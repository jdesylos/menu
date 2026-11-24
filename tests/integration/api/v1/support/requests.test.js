import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

async function submitRequest(body, sessionObject = null) {
  const headers = { "Content-Type": "application/json" };
  if (sessionObject) {
    headers.Cookie = `session_id=${sessionObject.token}`;
  }
  const response = await fetch(`${webserver.origin}/api/v1/support/requests`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

describe("Support info & public/user requests (Cláusula 1.2)", () => {
  test("GET /api/v1/support/info exposes contact and help guidance publicly", async () => {
    const response = await fetch(`${webserver.origin}/api/v1/support/info`);
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.contact.email).toBe("contato@menuspoiler.com.br");
    expect(body.categories.map((c) => c.id)).toEqual([
      "missing_place",
      "account_help",
      "general_help",
    ]);
    expect(body.guidance.length).toBeGreaterThanOrEqual(2);
  });

  test("Allows anonymous missing_place without GPS and account_help without login, without auto-publishing places", async () => {
    const missingPlace = await submitRequest({
      category: "missing_place",
      place_name: "Lanchonete Esquina Feliz",
      approximate_address: "Perto da estação Pinheiros",
    });
    expect(missingPlace.status).toBe(201);
    expect(missingPlace.body.request.category).toBe("missing_place");
    expect(missingPlace.body.request.status).toBe("open");

    // Não pode publicar automaticamente em places.
    const placesRes = await fetch(
      `${webserver.origin}/api/v1/places?q=${encodeURIComponent("Esquina Feliz")}`,
    );
    const placesBody = await placesRes.json();
    expect(placesBody.places).toEqual([]);

    const missingPlaceWithGps = await submitRequest({
      category: "missing_place",
      place_name: "Cantina Boa Massa",
      approximate_address: "Rua dos Pinheiros altura do 400",
      latitude: -23.5665,
      longitude: -46.6842,
      message: "Fica ao lado da farmácia",
    });
    expect(missingPlaceWithGps.status).toBe(201);

    const anonAccountHelp = await submitRequest({
      category: "account_help",
      contact_name: "Carlos",
      contact_email: "carlos.novo@menuspoiler.com.br",
      account_identifier: "carlos_antigo",
      subject: "Troquei de celular e perdi acesso",
      message: "Não recebo o código no meu e-mail antigo.",
    });
    expect(anonAccountHelp.status).toBe(201);
    expect(anonAccountHelp.body.request.category).toBe("account_help");

    // Ajuda anônima sem e-mail de contato falha com 400.
    const anonWithoutEmail = await submitRequest({
      category: "general_help",
      message: "Dúvida sem contato",
    });
    expect(anonWithoutEmail.status).toBe(400);

    // Anônimo não pode listar solicitações.
    const listAnon = await fetch(`${webserver.origin}/api/v1/support/requests`);
    expect(listAnon.status).toBe(403);
  });

  test("Authenticated user can submit and list only their own requests, and account deletion anonymizes PII", async () => {
    const u1 = await orchestrator.activateUser(
      await orchestrator.createUser({ username: "suporte_u1" }),
    );
    const s1 = await orchestrator.createSession(u1);

    const u2 = await orchestrator.activateUser(
      await orchestrator.createUser({ username: "suporte_u2" }),
    );
    const s2 = await orchestrator.createSession(u2);

    const created1 = await submitRequest(
      {
        category: "general_help",
        contact_email: "u1.contato@menuspoiler.com.br",
        subject: "Dúvida sobre cardápio",
        message: "Como atualizo fotos?",
      },
      s1,
    );
    expect(created1.status).toBe(201);

    await submitRequest(
      {
        category: "missing_place",
        place_name: "Restaurante Privado U2",
        approximate_address: "Rua B",
      },
      s2,
    );

    const list1 = await fetch(`${webserver.origin}/api/v1/support/requests`, {
      headers: { Cookie: `session_id=${s1.token}` },
    });
    expect(list1.status).toBe(200);
    const list1Body = await list1.json();
    expect(list1Body.requests).toHaveLength(1);
    expect(list1Body.requests[0].id).toBe(created1.body.request.id);
    expect(list1Body.requests[0]).not.toHaveProperty("handled_by");

    // Apagar a conta própria funciona e anonimiza PII na solicitação.
    const delRes = await fetch(`${webserver.origin}/api/v1/user`, {
      method: "DELETE",
      headers: { Cookie: `session_id=${s1.token}` },
    });
    expect(delRes.status).toBe(200);

    const row = await database.query({
      text: "SELECT contact_email, contact_name, account_identifier FROM support_requests WHERE id = $1;",
      values: [created1.body.request.id],
    });
    expect(row.rows[0].contact_email).toBeNull();
  });
});
