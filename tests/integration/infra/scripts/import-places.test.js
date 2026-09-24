import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import orchestrator from "tests/orchestrator.js";
import webserver from "infra/webserver.js";
import database from "infra/database.js";

const run = promisify(execFile);

const SCRIPT = "infra/scripts/import-places.mjs";

const HEADER =
  "source_id,name,category,latitude,longitude,neighborhood,street,postcode,locality,region";

// Dois lugares da Sé, perto o bastante para caírem no mesmo tile de z16.
const BAR_A = "ov-a,Bar A,bar,-23.5505,-46.6333,Sé,,,São Paulo,SP";
const BAR_B = "ov-b,Bar B,bar,-23.5506,-46.6334,Sé,,,São Paulo,SP";

beforeAll(async () => {
  await orchestrator.waitForAllServices();
});

beforeEach(async () => {
  await orchestrator.clearDatabase();
  await orchestrator.runPendingMigrations();
});

function writeFile(name, lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "import-places-"));
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`);
  return filePath;
}

function placesCsv(...rows) {
  return writeFile("lugares.csv", [HEADER, ...rows]);
}

// Roda o script como o `import-places.sh` roda: outro processo, com as
// credenciais do ambiente. Devolve o código de saída em vez de lançar, porque
// sair com erro é o comportamento esperado de um dos casos.
async function importPlaces(...args) {
  try {
    const { stdout, stderr } = await run("node", [SCRIPT, ...args], {
      env: process.env,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

async function place(sourceId) {
  const result = await database.query({
    text: `
      SELECT source_id, hidden_reason, duplicate_of
      FROM places WHERE source_id = $1
    ;`,
    values: [sourceId],
  });
  return result.rows[0];
}

async function idOf(sourceId) {
  const result = await database.query({
    text: "SELECT id FROM places WHERE source_id = $1;",
    values: [sourceId],
  });
  return result.rows[0].id;
}

describe("infra/scripts/import-places.mjs", () => {
  // Fechado não é apagado: a linha fica, oculta, com o motivo. É o que vai
  // segurar o cardápio pendurado nele.
  test("With a closed place", async () => {
    await importPlaces(placesCsv(BAR_A, BAR_B));

    const result = await importPlaces(
      placesCsv(BAR_A),
      `--fechados=${writeFile("fechados.csv", ["source_id", "ov-b"])}`,
    );
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("1 fechados ocultados");

    expect(await place("ov-b")).toEqual({
      source_id: "ov-b",
      hidden_reason: "closed",
      duplicate_of: null,
    });
    expect((await place("ov-a")).hidden_reason).toBeNull();
  });

  // O que a carga tirou e volta a vir no dado volta ao mapa.
  test("With a closed place that comes back", async () => {
    await importPlaces(placesCsv(BAR_A, BAR_B));
    await importPlaces(
      placesCsv(BAR_A),
      `--fechados=${writeFile("fechados.csv", ["source_id", "ov-b"])}`,
    );

    await importPlaces(placesCsv(BAR_A, BAR_B));

    expect((await place("ov-b")).hidden_reason).toBeNull();
  });

  test("With a duplicate", async () => {
    await importPlaces(placesCsv(BAR_A, BAR_B));

    const result = await importPlaces(
      placesCsv(BAR_A),
      `--duplicados=${writeFile("duplicados.csv", [
        "source_id,duplicate_of",
        "ov-b,ov-a",
      ])}`,
    );
    expect(result.code).toBe(0);

    expect(await place("ov-b")).toEqual({
      source_id: "ov-b",
      hidden_reason: "duplicate",
      duplicate_of: await idOf("ov-a"),
    });
  });

  // Sem --pais-inteiro, o que não veio pode só estar fora da caixa da carga:
  // fica onde estava.
  test("With a place missing from a partial load", async () => {
    await importPlaces(placesCsv(BAR_A, BAR_B));

    const result = await importPlaces(placesCsv(BAR_A));
    expect(result.code).toBe(0);

    expect((await place("ov-b")).hidden_reason).toBeNull();
  });

  test("With a place missing from a whole-country load", async () => {
    await importPlaces(placesCsv(BAR_A, BAR_B));

    const result = await importPlaces(placesCsv(BAR_A), "--pais-inteiro");
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("1 que sumiram do Overture ocultados");

    expect((await place("ov-b")).hidden_reason).toBe("missing_from_source");
    expect((await place("ov-a")).hidden_reason).toBeNull();
  });

  // A carga do Overture só mexe no que é dela.
  test("With a place from another source", async () => {
    await database.query(`
      INSERT INTO places (source, source_id, name, latitude, longitude)
      VALUES ('manual', 'feito-a-mao', 'Feito à Mão', -23.55, -46.63)
    ;`);

    await importPlaces(placesCsv(BAR_A), "--pais-inteiro");

    expect((await place("feito-a-mao")).hidden_reason).toBeNull();
  });

  // Um CSV que veio cortado não pode esvaziar o mapa: passando do limite, a
  // carga sai com erro e não oculta nada.
  test("With a whole-country load that would hide too much", async () => {
    await database.query(`
      INSERT INTO places (source, source_id, name, latitude, longitude)
      SELECT 'overture', 'ov-' || i, 'Lugar ' || i, -23.55, -46.63
      FROM generate_series(1, 1100) AS i
    ;`);

    const result = await importPlaces(placesCsv(BAR_A), "--pais-inteiro");

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("mais que o limite");

    const hidden = await database.query(
      "SELECT count(*)::int AS n FROM places WHERE hidden_at IS NOT NULL;",
    );
    expect(hidden.rows[0].n).toBe(0);
  });

  // O oculto sai das duas rotas que o aplicativo usa: a busca e o tile.
  test("With the routes", async () => {
    await importPlaces(placesCsv(BAR_A, BAR_B));
    await importPlaces(
      placesCsv(BAR_A),
      `--fechados=${writeFile("fechados.csv", ["source_id", "ov-b"])}`,
    );

    const search = await fetch(`${webserver.origin}/api/v1/places?q=bar`);
    const searchBody = await search.json();
    expect(searchBody.places.map((p) => p.name)).toEqual(["Bar A"]);

    // O tile de z16 que contém a Sé.
    const tile = await fetch(
      `${webserver.origin}/api/v1/places/16/24278/37181`,
    );
    const tileBody = await tile.json();
    expect(tileBody.places.map((p) => p.name)).toEqual(["Bar A"]);
  });
});
