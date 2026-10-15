import gemini from "infra/gemini.js";
import { ValidationError } from "infra/errors.js";

// Ler a foto de um cardápio: o pedido ao provedor de visão, e o cardápio que
// volta, já estruturado.
//
// O prompt e o formato da resposta moravam no aplicativo (`vision::remoto`) e
// vieram para cá junto com a chamada: melhorar a leitura não pede versão nova
// do aplicativo. O aplicativo recebe o cardápio no formato do schema abaixo e
// o converte para o modelo dele, que é quem confere preço e texto.
//
// A foto não é guardada: existe só na memória desta função enquanto é lida, e
// não vai para registro nenhum.

// A instrução — a mesma do teste que aprovou a leitura remota, com a regra da
// página que começa no meio de uma seção, para as páginas se juntarem.
const INSTRUCTION = `Esta é a foto de um cardápio de restaurante, ou de uma das páginas dele.

Extraia o cardápio como ele está escrito na folha, em JSON.

Regras:
- Copie o preço EXATAMENTE como está impresso. Nunca estime, deduza ou complete
  um preço que você não consegue ler: nesse caso use null.
- preco_centavos é um inteiro em centavos: "R$ 12,90" é 1290, "30" é 3000.
- Não invente pratos. Só o que está escrito na folha.
- Se o mesmo prato tem vários preços por tamanho (P/M/G, 175ml/250ml/garrafa),
  gere um item por tamanho, com o tamanho entre parênteses no nome.
- ingredientes é a descrição do prato quando houver, senão null.
- Ignore texto que não faz parte do cardápio: endereço, telefone, redes sociais,
  horário de funcionamento, avisos legais.
- Se a foto começa no meio de uma seção, sem o título dela acima dos primeiros
  pratos, ponha esses pratos numa seção com titulo "" (vazio). Não invente um
  título para ela.
`;

// O formato da resposta, imposto pelo provedor e não pedido por favor: o que
// chega já é o cardápio, validado contra isto.
const TEXT_OR_NULL = { type: ["string", "null"] };
const SCHEMA = {
  type: "object",
  properties: {
    secoes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          itens: {
            type: "array",
            items: {
              type: "object",
              properties: {
                nome: { type: "string" },
                preco_centavos: { type: ["integer", "null"] },
                ingredientes: TEXT_OR_NULL,
              },
              required: ["nome", "preco_centavos", "ingredientes"],
              additionalProperties: false,
            },
          },
        },
        required: ["titulo", "itens"],
        additionalProperties: false,
      },
    },
  },
  required: ["secoes"],
  additionalProperties: false,
};

// O aplicativo manda a foto reduzida a 1280 px no lado maior, em JPEG — umas
// centenas de KB. O teto é de pedido torto, e fica abaixo dos 4,5 MB que a
// Vercel aceita.
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

// Por que a leitura não saiu, como o aplicativo precisa saber: cada status
// vira uma frase diferente lá. O texto não cita o provedor — nenhuma tela
// cita.
export class ReadingError extends Error {
  constructor({ statusCode, name, message, action }) {
    super(message);
    this.name = name;
    this.action = action;
    this.statusCode = statusCode;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      action: this.action,
      status_code: this.statusCode,
    };
  }
}

// O que o aplicativo faz com cada uma: 503 é "tente mais tarde", 504 é
// "demorou, tente de novo", e 422 e 502 são "não foi possível ler".
function readingErrorFor(failure) {
  switch (failure) {
    case "not_configured":
    case "no_credit":
    case "bad_key":
    case "daily_quota":
      return new ReadingError({
        statusCode: 503,
        name: "ServiceError",
        message: "A leitura de cardápios está fora do ar agora.",
        action: "Tente mais tarde.",
      });
    case "minute_quota":
    case "overloaded":
    case "timeout":
    case "network":
      return new ReadingError({
        statusCode: 504,
        name: "ServiceError",
        message: "A leitura demorou demais.",
        action: "Tente de novo em instantes.",
      });
    case "refused":
      return new ReadingError({
        statusCode: 422,
        name: "ValidationError",
        message: "Não foi possível ler esta foto.",
        action: "Fotografe de novo, com o cardápio inteiro na foto.",
      });
    default:
      return new ReadingError({
        statusCode: 502,
        name: "ServiceError",
        message: "A leitura veio incompleta.",
        action: "Tente de novo.",
      });
  }
}

// Confere a foto antes de gastar uma chamada paga com ela.
function validatePhoto(photo) {
  if (photo.length === 0) {
    throw new ValidationError({
      message: "A foto não veio.",
      action: "Envie a foto do cardápio em JPEG no corpo do pedido.",
    });
  }
  if (photo.length > MAX_PHOTO_BYTES) {
    throw new ValidationError({
      message: "A foto passa de 3 MB.",
      action: "Reduza a foto antes de enviar.",
    });
  }
  // O começo de todo JPEG.
  if (photo[0] !== 0xff || photo[1] !== 0xd8 || photo[2] !== 0xff) {
    throw new ValidationError({
      message: "A foto não é um JPEG.",
      action: "Envie a foto do cardápio em JPEG.",
    });
  }
}

function requestBody(photo) {
  return {
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: photo.toString("base64"),
            },
          },
          { text: INSTRUCTION },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema: SCHEMA,
    },
  };
}

// O cardápio dentro da resposta do provedor, ou `null` se ele não estiver lá.
//
// A parte do pensamento, quando vem, é marcada com `thought: true`. A de texto
// vem acompanhada de `thoughtSignature` — então não dá para separar as duas
// pela presença da palavra "thought" no nome da chave.
function extractMenu(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;

  const text = parts.find(
    (part) => part.thought !== true && typeof part.text === "string",
  )?.text;
  if (text === undefined) return null;

  let menu;
  try {
    menu = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    typeof menu !== "object" ||
    menu === null ||
    !Array.isArray(menu.secoes)
  ) {
    return null;
  }
  return menu;
}

// Lê a foto. Devolve `{ model, menu, usage, path }`, ou lança `ReadingError`.
// `deadline` é o instante em que a leitura desiste — ver a rota.
async function read(photo, { deadline, ...options }) {
  validatePhoto(photo);

  const result = await gemini.generate(requestBody(photo), {
    deadline,
    ...options,
  });
  if (result.failure) {
    const error = readingErrorFor(result.failure);
    error.path = result.path;
    throw error;
  }

  const menu = extractMenu(result.response);
  if (menu === null) {
    const error = readingErrorFor("unreadable");
    error.path = result.path;
    throw error;
  }

  return {
    model: result.model,
    menu,
    usage: result.response.usageMetadata ?? null,
    path: result.path,
  };
}

const menuReading = {
  INSTRUCTION,
  SCHEMA,
  MAX_PHOTO_BYTES,
  ReadingError,
  readingErrorFor,
  validatePhoto,
  requestBody,
  extractMenu,
  read,
};

export default menuReading;
