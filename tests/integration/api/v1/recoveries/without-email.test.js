import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";
import authorization from "models/authorization.js";
import user from "models/user.js";

const EMAIL_HTTP_URL = `http://${process.env.EMAIL_HTTP_HOST}:${process.env.EMAIL_HTTP_PORT}`;

beforeAll(async () => {
  await orchestrator.waitForAllServices();
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

beforeEach(async () => {
  await orchestrator.deleteAllEmails();
  await database.query("DELETE FROM rate_limits;");
  await database.query("DELETE FROM support_requests;");
});

async function submitWithoutEmail(body) {
  const response = await fetch(
    `${webserver.origin}/api/v1/recoveries/without-email`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() };
}

async function listEmails() {
  const res = await fetch(`${EMAIL_HTTP_URL}/messages`);
  const items = await res.json();
  const detailed = [];
  for (const item of items) {
    const text = await fetch(
      `${EMAIL_HTTP_URL}/messages/${item.id}.plain`,
    ).then((r) => r.text());
    detailed.push({ ...item, text });
  }
  return detailed;
}

describe("GET & POST /api/v1/recoveries/without-email (Cláusula 1.4)", () => {
  test("GET exposes questionnaire without password fields and POST rejects passwords", async () => {
    const schemaRes = await fetch(
      `${webserver.origin}/api/v1/recoveries/without-email`,
    );
    expect(schemaRes.status).toBe(200);
    const schema = await schemaRes.json();
    expect(schema.fields.map((f) => f.id)).toContain("account_identifier");
    expect(schema.fields.some((f) => /password|senha/i.test(f.id))).toBe(false);

    const passwordRejected = await submitWithoutEmail({
      account_identifier: "alguem",
      new_email: "novo@menuspoiler.com.br",
      old_password: "123",
    });
    expect(passwordRejected.status).toBe(400);
  });

  test("Routes accounts without private history, admin accounts, and unknown accounts to support_requests with uniform 202", async () => {
    const noHistoryUser = await orchestrator.activateUser(
      await orchestrator.createUser({
        username: "leitor_puro",
        email: "leitor.antigo@menuspoiler.com.br",
      }),
    );

    const noHistoryRes = await submitWithoutEmail({
      account_identifier: "leitor_puro",
      new_email: "leitor.novo@menuspoiler.com.br",
      known_old_email: "leitor.antigo@menuspoiler.com.br",
      created_month: new Date().toISOString().slice(0, 7),
    });
    expect(noHistoryRes.status).toBe(202);
    expect(noHistoryRes.body.status).toBe("received");

    const adminAccount = await orchestrator.activateUser(
      await orchestrator.createUser({
        username: "admin_protegido",
        email: "admin.antigo@menuspoiler.com.br",
      }),
    );
    await orchestrator.addFeaturesToUser(
      adminAccount,
      authorization.ADMIN_PANEL_FEATURES,
    );

    const adminPlace = await database.query({
      text: `
        INSERT INTO places (source, source_id, name, category, latitude, longitude, locality)
        VALUES ('admin', 'rec-admin-p1', 'Padaria do Admin', 'bakery', -23.55, -46.63, 'São Paulo')
        RETURNING id
      ;`,
    });
    await orchestrator.insertMenu({
      placeId: adminPlace.rows[0].id,
      userId: adminAccount.id,
      itemNames: ["Pão francês"],
      createdAt: new Date(),
    });

    const adminRecoveryRes = await submitWithoutEmail({
      account_identifier: "admin_protegido",
      new_email: "invasor@menuspoiler.com.br",
      known_old_email: "admin.antigo@menuspoiler.com.br",
      submitted_place_names: ["Padaria do Admin"],
      activity_locality: "São Paulo",
    });
    expect(adminRecoveryRes.status).toBe(202);
    expect(adminRecoveryRes.body).toEqual(noHistoryRes.body);

    const unknownRes = await submitWithoutEmail({
      account_identifier: "conta_inexistente_xyz",
      new_email: "desconhecido@menuspoiler.com.br",
    });
    expect(unknownRes.status).toBe(202);
    expect(unknownRes.body).toEqual(noHistoryRes.body);

    // Nenhum e-mail automático de troca foi enviado em nenhum dos três casos.
    expect(await listEmails()).toHaveLength(0);

    const supportRows = await database.query(
      "SELECT category, user_id, contact_email, account_identifier, metadata FROM support_requests ORDER BY created_at ASC;",
    );
    expect(supportRows.rowCount).toBe(3);
    const byUser = supportRows.rows.find((r) => r.user_id === noHistoryUser.id);
    expect(byUser.metadata.reason).toBe("insufficient_private_history");
    expect(byUser.metadata.has_private_history).toBe(false);
    // Nunca armazena o e-mail antigo esperado dentro dos metadados do suporte.
    expect(JSON.stringify(byUser.metadata)).not.toContain(
      "leitor.antigo@menuspoiler.com.br",
    );

    const byAdmin = supportRows.rows.find((r) => r.user_id === adminAccount.id);
    expect(byAdmin.metadata.reason).toBe(
      "admin_account_requires_manual_review",
    );

    // Ao excluir a conta, o chamado de suporte anonimiza o PII do usuário.
    await user.erase(noHistoryUser.id);
    const erasedRow = await database.query({
      text: "SELECT contact_email, account_identifier FROM support_requests WHERE user_id = $1;",
      values: [noHistoryUser.id],
    });
    expect(erasedRow.rows[0].contact_email).toBeNull();
    expect(erasedRow.rows[0].account_identifier).toBeNull();
  });

  test("Auto-approves email change when private history + email match, confirms new email, and triggers password recovery", async () => {
    const owner = await orchestrator.activateUser(
      await orchestrator.createUser({
        username: "dono_com_cardapio",
        email: "dono.antigo@menuspoiler.com.br",
      }),
    );

    const colliding = await orchestrator.activateUser(
      await orchestrator.createUser({
        username: "outra_conta_x",
        email: "emuso@menuspoiler.com.br",
      }),
    );
    expect(colliding.id).toBeDefined();

    const pRes = await database.query({
      text: `
        INSERT INTO places (source, source_id, name, category, latitude, longitude, locality)
        VALUES ('admin', 'rec-place-1', 'Bistrô Jardim Europa', 'restaurant', -23.57, -46.67, 'São Paulo')
        RETURNING id
      ;`,
    });
    await orchestrator.insertMenu({
      placeId: pRes.rows[0].id,
      userId: owner.id,
      itemNames: ["Prato Feito"],
      createdAt: new Date(),
    });

    // Tentativa inconclusiva (local errado) vai para atendimento e não envia e-mail.
    const wrongPlaceRes = await submitWithoutEmail({
      account_identifier: "dono_com_cardapio",
      new_email: "dono.novo@menuspoiler.com.br",
      known_old_email: "dono.antigo@menuspoiler.com.br",
      submitted_place_names: ["Lugar Que Nunca Enviei"],
      activity_locality: "São Paulo",
    });
    expect(wrongPlaceRes.status).toBe(202);
    expect(await listEmails()).toHaveLength(0);

    // Conflito com novo e-mail já em uso nunca vaza erro 400 de e-mail em uso.
    const collisionRes = await submitWithoutEmail({
      account_identifier: "dono_com_cardapio",
      new_email: "emuso@menuspoiler.com.br",
      known_old_email: "dono.antigo@menuspoiler.com.br",
      submitted_place_names: ["Bistro Jardim Europa"],
      activity_locality: "Sao Paulo",
    });
    expect(collisionRes.status).toBe(202);
    expect(collisionRes.body).toEqual(wrongPlaceRes.body);
    expect(await listEmails()).toHaveLength(0);

    // Tentativa válida: aprova envio de confirmação para o novo e-mail.
    const okRes = await submitWithoutEmail({
      account_identifier: "dono_com_cardapio",
      new_email: "dono.novo@menuspoiler.com.br",
      known_old_email: "dono.antigo@menuspoiler.com.br",
      submitted_place_names: ["Bistro Jardim Europa"],
      activity_locality: "Sao Paulo",
    });
    expect(okRes.status).toBe(202);

    const emails = await listEmails();
    const confirmEmailMsg = emails.find((e) =>
      e.recipients.includes("<dono.novo@menuspoiler.com.br>"),
    );
    expect(confirmEmailMsg).toBeDefined();
    const tokenId = orchestrator.extractUUID(confirmEmailMsg.text);
    expect(tokenId).toBeTruthy();

    await orchestrator.deleteAllEmails();

    // Confirma posse do novo e-mail já pedindo link de redefinição de senha no fluxo existente.
    const confirmPatchRes = await fetch(
      `${webserver.origin}/api/v1/email-changes/${tokenId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ send_password_recovery: true }),
      },
    );
    expect(confirmPatchRes.status).toBe(200);
    const confirmBody = await confirmPatchRes.json();
    expect(confirmBody.email).toBe("dono.novo@menuspoiler.com.br");
    expect(confirmBody.password_recovery_requested).toBe(true);

    const recoveryMail = await orchestrator.getLastEmail();
    expect(recoveryMail.recipients[0]).toBe("<dono.novo@menuspoiler.com.br>");
    expect(recoveryMail.text).toContain("/senha/recuperar/");

    // 4ª tentativa no mesmo alvo dispara rate limit (429) sem duplicar spam no suporte.
    const abuseRes = await submitWithoutEmail({
      account_identifier: "dono_com_cardapio",
      new_email: "tentativa.extra@menuspoiler.com.br",
    });
    expect(abuseRes.status).toBe(429);

    const abuseRes2 = await submitWithoutEmail({
      account_identifier: "dono_com_cardapio",
      new_email: "outra.tentativa.extra@menuspoiler.com.br",
    });
    expect(abuseRes2.status).toBe(429);

    const supportAfterAbuse = await database.query({
      text: "SELECT metadata FROM support_requests WHERE user_id = $1 AND metadata->>'reason' = 'abuse_rate_limit';",
      values: [owner.id],
    });
    expect(supportAfterAbuse.rowCount).toBe(1);
    expect(
      supportAfterAbuse.rows[0].metadata.attempt_count,
    ).toBeGreaterThanOrEqual(2);
  });
});
