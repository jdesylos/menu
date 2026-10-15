// O provedor de visão — o Gemini —, chamado pelo SERVIDOR.
//
// A chave (`GEMINI_API_KEY`) vive só na variável de ambiente e não sai daqui:
// o aplicativo manda a foto a `POST /api/v1/vision/read`, e quem fala com o
// Google é este arquivo. Antes era o aplicativo que chamava, com a chave
// entregue por `GET /api/v1/vision/key`, e quem tivesse uma conta e o
// aplicativo tinha a chave.
//
// Veio do aplicativo (`net::gemini`), com a mesma cadeia de modelos e a mesma
// leitura das falhas. O pedido é montado por quem chama — ver
// `models/menuReading.js`; aqui só se decide com que modelo, e quando
// desistir.

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

// A ordem, do melhor ao último recurso. Sem o Pro, por decisão: o Flash leu
// todas as folhas do teste sem errar preço. O Lite fica por último porque lê
// pior — cai nele só quem ficou sem opção, e o registro diz que foi ele.
const CHAIN = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
];

// Uma leitura com raciocínio leva de dez a sessenta segundos. É o teto de UMA
// chamada; o da leitura inteira é de quem chama (`deadline`).
const CALL_TIMEOUT_MS = 90_000;

// As falhas que fazem passar ao próximo modelo: as que são do MODELO. As
// outras são da conta (crédito, chave), do pedido (a foto recusada) ou do
// caminho (rede), e o próximo modelo daria no mesmo.
const SWITCHES_MODEL = new Set([
  "daily_quota",
  "minute_quota",
  "overloaded",
  "timeout",
]);

// O que a resposta de erro diz.
//
// O 429 traz no corpo qual cota acabou, e é isso que separa a diária — que
// não volta esperando — da por minuto, que volta. O 402 fala da CONTA:
// acabou o crédito, e nenhum modelo responde até alguém carregar.
function classify(status, body) {
  if (status === 402) return "no_credit";
  if (status === 429) {
    return body.includes("PerDay") ? "daily_quota" : "minute_quota";
  }
  if ([500, 502, 503, 504].includes(status)) return "overloaded";
  if (status === 401 || status === 403) return "bad_key";
  return "refused";
}

// O dia da cota, que vira à meia-noite do Pacífico, e não à do UTC. O
// deslocamento é o do horário padrão; no de verão a virada é uma hora antes, e
// o pior caso é pular por uma hora um modelo que já voltou.
function quotaDay(nowMs) {
  const PACIFIC_MS = 8 * 60 * 60 * 1000;
  return Math.floor((nowMs - PACIFIC_MS) / (24 * 60 * 60 * 1000));
}

// Os modelos cuja cota do dia acabou, na memória da instância. Uma instância
// nova começa sem saber, e o primeiro 429 — que não custa nada — os tira da
// cadeia de novo. Guardar no banco pouparia essa ida, e não se paga.
const exhaustedToday = new Map();

async function call(model, body, { apiKey, timeoutMs, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(`${ENDPOINT}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      return { failure: "timeout" };
    }
    return { failure: "network", detail: error.message };
  }

  const text = await response.text();
  if (!response.ok) {
    return {
      failure: classify(response.status, text),
      detail: `${response.status} ${text.split(/\s+/).join(" ").slice(0, 160)}`,
    };
  }

  try {
    return { response: JSON.parse(text) };
  } catch {
    return { failure: "unreadable", detail: "resposta que não é JSON" };
  }
}

// Percorre a cadeia até um modelo responder, ou até `deadline` (um instante,
// em milissegundos): passado dele, não se chama mais modelo nenhum.
//
// Devolve `{ model, response, path }` quando um modelo respondeu, e
// `{ failure, path }` quando nenhum respondeu — `failure` é a última falha, a
// que encerrou a cadeia. `path` é cada modelo tentado e o que ele respondeu: é
// o que diz, no registro, que a leitura caiu num modelo pior.
//
// `fetchImpl`, `now` e `memory` existem para o teste dizer o que o provedor
// respondeu e que horas são, sem rede.
async function generate(
  body,
  { deadline, fetchImpl = fetch, now = Date.now, memory = exhaustedToday } = {},
) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { failure: "not_configured", path: [] };

  const path = [];
  // Nenhum modelo chamado quer dizer que todos já estavam esgotados.
  let last = "daily_quota";

  for (const model of CHAIN) {
    const today = quotaDay(now());
    if (memory.get(model) === today) {
      path.push([model, "esgotado hoje"]);
      continue;
    }

    const remaining = deadline - now();
    if (remaining <= 0) {
      path.push([model, "sem tempo"]);
      last = "timeout";
      break;
    }

    const result = await call(model, body, {
      apiKey,
      timeoutMs: Math.min(CALL_TIMEOUT_MS, remaining),
      fetchImpl,
    });

    if (result.response) {
      path.push([model, "ok"]);
      return { model, response: result.response, path };
    }

    path.push([model, result.detail || result.failure]);
    if (result.failure === "daily_quota") memory.set(model, today);
    if (!SWITCHES_MODEL.has(result.failure)) {
      return { failure: result.failure, path };
    }
    last = result.failure;
  }

  return { failure: last, path };
}

const gemini = {
  CHAIN,
  classify,
  quotaDay,
  generate,
};

export default gemini;
