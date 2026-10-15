import gemini from "infra/gemini.js";

// O provedor responde o que cada teste disser: a política da cadeia — que é o
// que decide quanta cota e quanto tempo se gasta — é testada sem rede.
const ambiente = { ...process.env };

beforeEach(() => {
  process.env.GEMINI_API_KEY = "chave-de-teste";
});

afterEach(() => {
  process.env = { ...ambiente };
});

const OK = {
  candidates: [{ content: { parts: [{ text: '{"secoes":[]}' }] } }],
};

// Um provedor de mentira: cada chamada responde o próximo da lista, e anota a
// que modelo foi.
function provedor(respostas) {
  const chamados = [];
  const fetchImpl = async (url, init) => {
    chamados.push({ url, init });
    const proxima = respostas.shift();
    if (proxima instanceof Error) throw proxima;
    return new Response(
      typeof proxima.body === "string"
        ? proxima.body
        : JSON.stringify(proxima.body),
      { status: proxima.status },
    );
  };
  const modelos = () =>
    chamados.map(({ url }) => url.match(/models\/(.+):generateContent/)[1]);
  return { fetchImpl, chamados, modelos };
}

const AGORA = Date.parse("2026-10-15T15:00:00Z");
const opcoes = (extra) => ({
  deadline: AGORA + 270_000,
  now: () => AGORA,
  memory: new Map(),
  ...extra,
});

describe("infra/gemini.js", () => {
  test("O primeiro modelo responde", async () => {
    const { fetchImpl, chamados, modelos } = provedor([
      { status: 200, body: OK },
    ]);

    const resultado = await gemini.generate({ a: 1 }, opcoes({ fetchImpl }));

    expect(resultado.model).toBe("gemini-3.8-flash");
    expect(resultado.response).toEqual(OK);
    expect(modelos()).toEqual(["gemini-3.8-flash"]);
    // A chave vai no cabeçalho, e não no endereço — endereço vai para log.
    expect(chamados[0].init.headers["x-goog-api-key"]).toBe("chave-de-teste");
    expect(chamados[0].url).not.toContain("chave-de-teste");
  });

  test("Sobrecarga e cota por minuto passam ao próximo modelo", async () => {
    const { fetchImpl, modelos } = provedor([
      { status: 503, body: "overloaded" },
      { status: 429, body: "PerMinute" },
      { status: 200, body: OK },
    ]);

    const resultado = await gemini.generate({}, opcoes({ fetchImpl }));

    expect(resultado.model).toBe("gemini-3.6-flash");
    expect(modelos()).toEqual([
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
    ]);
    expect(resultado.path.map(([modelo]) => modelo)).toEqual(modelos());
  });

  // A cota do dia não volta esperando: o modelo sai da cadeia até o dia virar,
  // e a leitura seguinte nem o chama.
  test("A cota do dia tira o modelo da cadeia até o dia virar", async () => {
    const memory = new Map();
    const primeiro = provedor([
      { status: 429, body: "GenerateRequestsPerDay" },
      { status: 200, body: OK },
    ]);
    await gemini.generate(
      {},
      opcoes({ fetchImpl: primeiro.fetchImpl, memory }),
    );

    const segundo = provedor([{ status: 200, body: OK }]);
    const resultado = await gemini.generate(
      {},
      opcoes({ fetchImpl: segundo.fetchImpl, memory }),
    );
    expect(segundo.modelos()).toEqual(["gemini-3.7-flash"]);
    expect(resultado.path[0]).toEqual(["gemini-3.8-flash", "esgotado hoje"]);

    // No dia seguinte da cota, ele volta.
    const terceiro = provedor([{ status: 200, body: OK }]);
    await gemini.generate(
      {},
      opcoes({
        fetchImpl: terceiro.fetchImpl,
        memory,
        now: () => AGORA + 24 * 60 * 60 * 1000,
        deadline: AGORA + 24 * 60 * 60 * 1000 + 270_000,
      }),
    );
    expect(terceiro.modelos()).toEqual(["gemini-3.8-flash"]);
  });

  // Falha da conta, da chave, do pedido ou do caminho: o próximo modelo daria
  // no mesmo, e chamá-lo só gastaria tempo.
  test.each([
    [402, "sem crédito", "no_credit"],
    [403, "API key not valid", "bad_key"],
    [400, "Invalid image", "refused"],
  ])("Com %i, para na hora", async (status, body, falha) => {
    const { fetchImpl, modelos } = provedor([{ status, body }]);

    const resultado = await gemini.generate({}, opcoes({ fetchImpl }));

    expect(resultado.failure).toBe(falha);
    expect(modelos()).toEqual(["gemini-3.8-flash"]);
  });

  test("Sem rede, para na hora", async () => {
    const { fetchImpl, modelos } = provedor([new TypeError("fetch failed")]);

    const resultado = await gemini.generate({}, opcoes({ fetchImpl }));

    expect(resultado.failure).toBe("network");
    expect(modelos()).toHaveLength(1);
  });

  test("O prazo de um modelo passa ao próximo", async () => {
    const prazo = new Error("The operation was aborted due to timeout");
    prazo.name = "TimeoutError";
    const { fetchImpl, modelos } = provedor([prazo, { status: 200, body: OK }]);

    const resultado = await gemini.generate({}, opcoes({ fetchImpl }));

    expect(resultado.model).toBe("gemini-3.7-flash");
    expect(modelos()).toHaveLength(2);
  });

  // Passado o prazo da leitura inteira, não se chama mais modelo nenhum.
  test("Sem tempo, não chama o próximo", async () => {
    let agora = AGORA;
    const { fetchImpl, modelos } = provedor([
      { status: 503, body: "overloaded" },
    ]);
    const lento = async (...args) => {
      agora += 300_000;
      return fetchImpl(...args);
    };

    const resultado = await gemini.generate(
      {},
      opcoes({ fetchImpl: lento, now: () => agora }),
    );

    expect(resultado.failure).toBe("timeout");
    expect(modelos()).toHaveLength(1);
  });

  test("Todos os modelos fora", async () => {
    const { fetchImpl, modelos } = provedor(
      gemini.CHAIN.map(() => ({ status: 503, body: "overloaded" })),
    );

    const resultado = await gemini.generate({}, opcoes({ fetchImpl }));

    expect(resultado.failure).toBe("overloaded");
    expect(modelos()).toEqual(gemini.CHAIN);
  });

  test("Sem a chave no ambiente, nem tenta", async () => {
    delete process.env.GEMINI_API_KEY;
    const { fetchImpl, modelos } = provedor([]);

    const resultado = await gemini.generate({}, opcoes({ fetchImpl }));

    expect(resultado.failure).toBe("not_configured");
    expect(modelos()).toEqual([]);
  });

  test("O dia da cota vira à meia-noite do Pacífico", () => {
    // 07:59 UTC ainda é o dia anterior no Pacífico; 08:00 já é o seguinte.
    const antes = gemini.quotaDay(Date.parse("2026-10-15T07:59:00Z"));
    const depois = gemini.quotaDay(Date.parse("2026-10-15T08:00:00Z"));
    expect(depois - antes).toBe(1);
  });
});
