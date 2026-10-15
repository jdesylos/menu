import rota from "pages/api/v1/vision/read/index.js";
import session from "models/session.js";
import user from "models/user.js";
import auditLog from "models/auditLog.js";
import menuReading from "models/menuReading.js";

// A rota exige sessão, e quem a resolve é o banco; quem lê é o provedor. Aqui
// nenhum dos dois entra: os modelos respondem o que cada teste disser, e o
// que se afirma é o que a ROTA faz com isso. A rota de verdade, contra o
// banco, está em `tests/integration/api/v1/vision/read` — só os caminhos que
// não chegam ao provedor, que é pago.
jest.mock("models/session.js", () => ({
  __esModule: true,
  default: { findOneValidByToken: jest.fn() },
}));
jest.mock("models/user.js", () => ({
  __esModule: true,
  default: { findOneById: jest.fn() },
}));
jest.mock("models/auditLog.js", () => ({
  __esModule: true,
  default: { record: jest.fn() },
}));
jest.mock("models/menuReading.js", () => {
  const real = jest.requireActual("models/menuReading.js");
  return {
    __esModule: true,
    ReadingError: real.ReadingError,
    default: { ...real.default, read: jest.fn() },
  };
});

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const CARDAPIO = { secoes: [{ titulo: "Pratos", itens: [] }] };

// O pedido: o corpo chega aos pedaços, como do socket.
function pedido(corpo, cookies = {}) {
  return {
    method: "POST",
    url: "/api/v1/vision/read",
    headers: { "content-type": "image/jpeg" },
    cookies,
    socket: { remoteAddress: "10.0.0.1" },
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < corpo.length; i += 2) yield corpo.subarray(i, i + 2);
    },
  };
}

function entrou(features) {
  session.findOneValidByToken.mockResolvedValue({ user_id: "conta-de-teste" });
  user.findOneById.mockResolvedValue({ id: "conta-de-teste", features });
  return { session_id: "sessao-de-teste" };
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
    json(corpo) {
      r.corpo = JSON.parse(JSON.stringify(corpo));
      return r;
    },
    setHeader(nome, valor) {
      r.headers[nome] = valor;
    },
    end() {
      return r;
    },
  };
  return r;
}

describe("POST /api/v1/vision/read", () => {
  test("Lê a foto de quem pode mandar cardápio", async () => {
    menuReading.read.mockResolvedValue({
      model: "gemini-3.8-flash",
      menu: CARDAPIO,
      usage: { promptTokenCount: 1000 },
      path: [["gemini-3.8-flash", "ok"]],
    });
    const r = resposta();

    await rota(pedido(JPEG, entrou(["create:menu"])), r);

    expect(r.statusCode).toBe(200);
    expect(r.corpo).toEqual({ model: "gemini-3.8-flash", menu: CARDAPIO });
    expect(r.headers["Cache-Control"]).toBe("no-store");
    // O corpo inteiro chegou à leitura, junto com o prazo dela.
    const [foto, { deadline }] = menuReading.read.mock.calls[0];
    expect(foto.equals(JPEG)).toBe(true);
    expect(deadline).toBeGreaterThan(Date.now());
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "vision.read",
        actorUserId: "conta-de-teste",
      }),
    );
  });

  // A leitura que não saiu também gastou uma chamada, e também fica registrada.
  test("A falha da leitura sai com o status dela", async () => {
    menuReading.read.mockRejectedValue(
      menuReading.readingErrorFor("overloaded"),
    );
    const r = resposta();

    await rota(pedido(JPEG, entrou(["create:menu"])), r);

    expect(r.statusCode).toBe(504);
    expect(r.corpo).toEqual({
      name: "ServiceError",
      message: "A leitura demorou demais.",
      action: "Tente de novo em instantes.",
      status_code: 504,
    });
    expect(auditLog.record).toHaveBeenCalled();
  });

  test("Sem conta, não lê", async () => {
    const r = resposta();

    await rota(pedido(JPEG), r);

    expect(r.statusCode).toBe(403);
    expect(menuReading.read).not.toHaveBeenCalled();
  });

  test("A conta que não pode mandar cardápio não lê", async () => {
    const r = resposta();

    await rota(pedido(JPEG, entrou(["read:activation_token"])), r);

    expect(r.statusCode).toBe(403);
    expect(menuReading.read).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  // O teto é conferido enquanto o corpo chega: o resto nem é lido.
  test("A foto grande demais é recusada", async () => {
    const r = resposta();
    const grande = Buffer.alloc(menuReading.MAX_PHOTO_BYTES + 2, 0xff);

    await rota(pedido(grande, entrou(["create:menu"])), r);

    expect(r.statusCode).toBe(400);
    expect(r.corpo.message).toBe("A foto passa de 3 MB.");
    expect(menuReading.read).not.toHaveBeenCalled();
  });
});
