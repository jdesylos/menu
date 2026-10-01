import rota from "pages/api/v1/vision/key/index.js";
import session from "models/session.js";
import user from "models/user.js";

// A rota exige sessão, e quem a resolve é o banco. Aqui o banco não entra:
// os dois modelos respondem o que cada teste disser, e o que se afirma é o que
// a ROTA faz com a conta que recebeu.
jest.mock("models/session.js", () => ({
  __esModule: true,
  default: { findOneValidByToken: jest.fn() },
}));
jest.mock("models/user.js", () => ({
  __esModule: true,
  default: { findOneById: jest.fn() },
}));

// Teste de UNIDADE, e não de integração como o resto das rotas: o que se
// afirma aqui é o comportamento quando a variável de ambiente falta, e o
// servidor do teste de integração roda em OUTRO processo — mexer no
// `process.env` daqui não chegaria nele.
const ambiente = { ...process.env };

afterEach(() => {
  process.env = { ...ambiente };
  jest.resetAllMocks();
});

function pedido(headers = {}, cookies = {}) {
  return { method: "GET", url: "/api/v1/vision/key", headers, cookies };
}

// Quem entrou, com as features dadas. O cookie só precisa existir: quem diz
// de quem é a sessão são os modelos de mentira.
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

describe("GET /api/v1/vision/key", () => {
  describe("com a leitura remota configurada", () => {
    beforeEach(() => {
      process.env.GEMINI_API_KEY = "chave-de-teste";
      process.env.VISION_TOKEN = "token-de-teste";
    });

    test("entrega a chave a quem tem o token e pode mandar cardápio", async () => {
      const r = resposta();
      await rota(
        pedido({ "x-vision-token": "token-de-teste" }, entrou(["create:menu"])),
        r,
      );

      expect(r.statusCode).toBe(200);
      expect(r.corpo).toEqual({ key: "chave-de-teste" });
      // Chave em cache de borda sobreviveria à troca dela, que é justamente o
      // que esta rota existe para permitir.
      expect(r.headers["Cache-Control"]).toBe("no-store");
    });

    test("recusa quem não traz o token", async () => {
      const r = resposta();
      await rota(pedido(), r);

      expect(r.statusCode).toBe(403);
      expect(r.corpo.name).toBe("ForbiddenError");
      expect(JSON.stringify(r.corpo)).not.toContain("chave-de-teste");
    });

    test("recusa quem traz o token errado", async () => {
      const r = resposta();
      await rota(pedido({ "x-vision-token": "outro" }), r);

      expect(r.statusCode).toBe(403);
    });

    // O token sozinho é só o aplicativo aberto. A leitura é de quem entrou.
    test("recusa quem tem o token mas não entrou", async () => {
      const r = resposta();
      await rota(pedido({ "x-vision-token": "token-de-teste" }), r);

      expect(r.statusCode).toBe(403);
      expect(r.corpo.action).toBe(
        'Verifique se o seu usuário possui a feature "create:menu"',
      );
      expect(JSON.stringify(r.corpo)).not.toContain("chave-de-teste");
    });

    test("recusa a conta que não pode mandar cardápio", async () => {
      const r = resposta();
      await rota(
        pedido(
          { "x-vision-token": "token-de-teste" },
          entrou(["read:activation_token"]),
        ),
        r,
      );

      expect(r.statusCode).toBe(403);
      expect(JSON.stringify(r.corpo)).not.toContain("chave-de-teste");
    });
  });

  describe("sem a leitura remota configurada", () => {
    test("diz que está indisponível quando falta a chave", async () => {
      delete process.env.GEMINI_API_KEY;
      process.env.VISION_TOKEN = "token-de-teste";

      const r = resposta();
      await rota(pedido({ "x-vision-token": "token-de-teste" }), r);

      expect(r.statusCode).toBe(503);
      expect(r.corpo.name).toBe("ServiceError");
    });

    // Sem token a rota ficaria ABERTA a qualquer um. Em vez de servir sem
    // tranca, ela se desliga.
    test("não serve sem tranca quando falta o token", async () => {
      process.env.GEMINI_API_KEY = "chave-de-teste";
      delete process.env.VISION_TOKEN;

      const r = resposta();
      await rota(pedido(), r);

      expect(r.statusCode).toBe(503);
      expect(JSON.stringify(r.corpo)).not.toContain("chave-de-teste");
    });
  });
});
