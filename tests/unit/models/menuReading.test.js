import menuReading from "models/menuReading.js";
import gemini from "infra/gemini.js";
import { ValidationError } from "infra/errors.js";

// O provedor não entra: `gemini.generate` responde o que cada teste disser, e
// o que se afirma é o que a leitura faz com isso.
jest.mock("infra/gemini.js", () => ({
  __esModule: true,
  default: { generate: jest.fn() },
}));

afterEach(() => {
  jest.resetAllMocks();
});

// O começo de um JPEG, e o bastante para passar pela conferência.
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

const CARDAPIO = {
  secoes: [
    {
      titulo: "Pratos",
      itens: [{ nome: "Feijoada", preco_centavos: 4500, ingredientes: null }],
    },
  ],
};

function respostaCom(parts) {
  return {
    candidates: [{ content: { parts } }],
    usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 },
  };
}

describe("models/menuReading.js", () => {
  test("Lê o cardápio da resposta do provedor", async () => {
    gemini.generate.mockResolvedValue({
      model: "gemini-3.8-flash",
      response: respostaCom([{ text: JSON.stringify(CARDAPIO) }]),
      path: [["gemini-3.8-flash", "ok"]],
    });

    const lido = await menuReading.read(JPEG, { deadline: 1 });

    expect(lido.model).toBe("gemini-3.8-flash");
    expect(lido.menu).toEqual(CARDAPIO);
    expect(lido.usage.promptTokenCount).toBe(1000);

    // O pedido leva a foto, a instrução e o schema — o que o aplicativo
    // montava antes.
    const [corpo, { deadline }] = gemini.generate.mock.calls[0];
    expect(deadline).toBe(1);
    const [imagem, texto] = corpo.contents[0].parts;
    expect(imagem.inlineData).toEqual({
      mimeType: "image/jpeg",
      data: JPEG.toString("base64"),
    });
    expect(texto.text).toBe(menuReading.INSTRUCTION);
    expect(corpo.generationConfig.responseJsonSchema).toEqual(
      menuReading.SCHEMA,
    );
  });

  // A parte do pensamento vem antes, marcada com `thought: true`; a de texto
  // vem com `thoughtSignature`, e é ela o cardápio.
  test("Pula a parte do pensamento", async () => {
    gemini.generate.mockResolvedValue({
      model: "gemini-3.8-flash",
      response: respostaCom([
        { text: "pensando no cardápio…", thought: true },
        { text: JSON.stringify(CARDAPIO), thoughtSignature: "abc" },
      ]),
      path: [],
    });

    const lido = await menuReading.read(JPEG, { deadline: 1 });

    expect(lido.menu).toEqual(CARDAPIO);
  });

  test.each([
    ["sem partes", { candidates: [{ finishReason: "SAFETY" }] }],
    ["texto que não é JSON", respostaCom([{ text: "não sei ler" }])],
    ["JSON sem seções", respostaCom([{ text: '{"pratos":[]}' }])],
  ])("Resposta %s vira 502", async (_, response) => {
    gemini.generate.mockResolvedValue({ model: "m", response, path: [] });

    const erro = await menuReading.read(JPEG, { deadline: 1 }).catch((e) => e);

    expect(erro).toBeInstanceOf(menuReading.ReadingError);
    expect(erro.statusCode).toBe(502);
  });

  // Cada falha vira o status que o aplicativo traduz numa frase: 503 é "tente
  // mais tarde", 504 é "tente de novo", e 422 é a foto que não se lê.
  test.each([
    ["not_configured", 503],
    ["no_credit", 503],
    ["bad_key", 503],
    ["daily_quota", 503],
    ["minute_quota", 504],
    ["overloaded", 504],
    ["timeout", 504],
    ["network", 504],
    ["refused", 422],
  ])("A falha %s vira %i", async (failure, statusCode) => {
    gemini.generate.mockResolvedValue({ failure, path: [["m", failure]] });

    const erro = await menuReading.read(JPEG, { deadline: 1 }).catch((e) => e);

    expect(erro.statusCode).toBe(statusCode);
    expect(erro.path).toEqual([["m", failure]]);
    // Nenhuma tela cita o provedor.
    expect(JSON.stringify(erro)).not.toMatch(/gemini|google|IA\b/i);
  });

  test.each([
    ["vazia", Buffer.alloc(0)],
    ["que não é JPEG", Buffer.from("PNG\r\n")],
    ["grande demais", Buffer.alloc(menuReading.MAX_PHOTO_BYTES + 1, 0xff)],
  ])("Foto %s não gasta chamada", async (_, foto) => {
    const erro = await menuReading.read(foto, { deadline: 1 }).catch((e) => e);

    expect(erro).toBeInstanceOf(ValidationError);
    expect(gemini.generate).not.toHaveBeenCalled();
  });
});
