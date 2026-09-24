import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";

const run = promisify(execFile);

const SCRIPT = "infra/scripts/import-manual-places.mjs";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
});

beforeEach(async () => {
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

// Roda o script como o `npm run places:manual` roda: outro processo, com as
// credenciais do ambiente. Devolve o código de saída em vez de lançar, porque
// sair com erro é o comportamento esperado de um dos casos.
async function importManual(filePath) {
  const args = filePath ? [SCRIPT, filePath] : [SCRIPT];

  try {
    const { stdout, stderr } = await run("node", args, { env: process.env });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

function writeList(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manual-places-"));
  const filePath = path.join(dir, "manual-places.json");
  fs.writeFileSync(filePath, JSON.stringify(entries));
  return filePath;
}

async function placesBySource(source) {
  const result = await database.query({
    text: "SELECT source_id, name FROM places WHERE source = $1 ORDER BY source_id;",
    values: [source],
  });
  return result.rows;
}

const PADARIA = {
  id: "padaria-teste",
  name: "Padaria de Teste",
  category: "bakery",
  latitude: -23.5505,
  longitude: -46.6333,
  fonte: "Inventada para o teste.",
};

describe("infra/scripts/import-manual-places.mjs", () => {
  // A lista versionada chega à busca do aplicativo como qualquer outro lugar.
  test("With the versioned list", async () => {
    const result = await importManual();
    expect(result.code).toBe(0);

    const response = await fetch(
      `${webserver.origin}/api/v1/places?q=tia%20lourdes`,
    );
    expect(response.status).toBe(200);

    const responseBody = await response.json();
    expect(responseBody.places).toEqual([
      {
        name: "Restaurante Tia Lourdes",
        category: "brazilian_restaurant",
        latitude: -23.56895,
        longitude: -46.71486,
        street: "Av. Vital Brasil, 1250 - Loja 5B",
        neighborhood: "Butantã",
        locality: "São Paulo",
        region: "SP",
        postcode: "05503-000",
      },
    ]);
  });

  // O arquivo é a lista inteira: o que sai dele sai do banco. E só o que é
  // "manual" — o lugar do Overture continua onde estava.
  test("With an entry removed from the file", async () => {
    await database.query({
      text: `
        INSERT INTO places (source, source_id, name, latitude, longitude)
        VALUES ('overture', 'ov-1', 'Bar do Overture', -23.55, -46.63)
      ;`,
    });
    await importManual();

    const result = await importManual(writeList([PADARIA]));
    expect(result.code).toBe(0);

    expect(await placesBySource("manual")).toEqual([
      { source_id: "padaria-teste", name: "Padaria de Teste" },
    ]);
    expect(await placesBySource("overture")).toEqual([
      { source_id: "ov-1", name: "Bar do Overture" },
    ]);
  });

  // Uma entrada torta derruba a carga inteira ANTES de tocar no banco: pular
  // só ela faria a remoção apagar um lugar que continua no arquivo.
  test("With an invalid entry", async () => {
    await importManual(writeList([PADARIA]));

    const result = await importManual(
      writeList([
        PADARIA,
        {
          id: "sem-fonte",
          name: "Lugar Sem Fonte",
          latitude: -46.6333,
          longitude: -23.5505,
        },
      ]),
    );

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('falta "fonte"');
    expect(result.stderr).toContain("fora do Brasil");
    expect(await placesBySource("manual")).toEqual([
      { source_id: "padaria-teste", name: "Padaria de Teste" },
    ]);
  });
});
