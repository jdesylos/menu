import rota from "pages/api/v1/vision/key/index.js";

// Teste de UNIDADE, e não de integração como o resto das rotas: o que se
// afirma aqui é o comportamento quando a variável de ambiente falta, e o
// servidor do teste de integração roda em OUTRO processo — mexer no
// `process.env` daqui não chegaria nele.
const ambiente = { ...process.env };

afterEach(() => {
  process.env = { ...ambiente };
});

function pedido(headers = {}) {
  return { method: "GET", url: "/api/v1/vision/key", headers };
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

    test("entrega a chave a quem tem o token", async () => {
      const r = resposta();
      await rota(pedido({ "x-vision-token": "token-de-teste" }), r);

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
