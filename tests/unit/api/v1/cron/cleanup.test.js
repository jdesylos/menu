import rota from "pages/api/v1/cron/cleanup/index.js";
import database from "infra/database.js";

jest.mock("infra/database.js", () => ({
  __esModule: true,
  default: {
    withSharedClient: jest.fn(),
    query: jest.fn(),
  },
}));

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  database.withSharedClient.mockImplementation((callback) => callback());
});

afterEach(() => {
  jest.resetAllMocks();
  if (ORIGINAL_SECRET === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = ORIGINAL_SECRET;
  }
});

function pedido(headers = {}) {
  return {
    method: "GET",
    url: "/api/v1/cron/cleanup",
    headers,
  };
}

function resposta() {
  const r = {
    statusCode: null,
    corpo: null,
    headers: {},
    status(codigo) {
      r.statusCode = codigo;
      return r;
    },
    setHeader(nome, valor) {
      r.headers[nome] = valor;
    },
    json(corpo) {
      r.corpo = JSON.parse(JSON.stringify(corpo));
      return r;
    },
  };
  return r;
}

describe("GET /api/v1/cron/cleanup", () => {
  test("Recusa quando CRON_SECRET não está configurado", async () => {
    delete process.env.CRON_SECRET;
    const r = resposta();

    await rota(pedido({ authorization: "Bearer segredo" }), r);

    expect(r.statusCode).toBe(401);
    expect(database.query).not.toHaveBeenCalled();
  });

  test("Recusa quando o segredo não confere", async () => {
    process.env.CRON_SECRET = "segredo-correto";
    const r = resposta();

    await rota(pedido({ authorization: "Bearer segredo-errado" }), r);

    expect(r.statusCode).toBe(401);
    expect(database.query).not.toHaveBeenCalled();
  });

  test("Executa a limpeza com CRON_SECRET válido", async () => {
    process.env.CRON_SECRET = "segredo-correto";
    const deleted = {
      rate_limits: 4,
      sessions: 2,
      activation_tokens: 1,
      recovery_tokens: 3,
    };
    database.query.mockResolvedValue({ rows: [deleted] });
    const r = resposta();

    await rota(pedido({ authorization: "Bearer segredo-correto" }), r);

    expect(r.statusCode).toBe(200);
    expect(r.headers["Cache-Control"]).toBe("no-store");
    expect(r.corpo).toEqual({ deleted });
    expect(database.query).toHaveBeenCalledTimes(1);
  });
});
