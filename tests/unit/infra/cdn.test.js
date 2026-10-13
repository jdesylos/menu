import { dangerouslyDeleteByTag, waitUntil } from "@vercel/functions";
import cdn from "infra/cdn.js";

// A borda da Vercel não existe fora dela: o pacote é trocado por um de
// mentira, e o que se afirma é o que se PEDE a ele — e que a falha dele não
// chega a quem chamou.
jest.mock("@vercel/functions", () => ({
  __esModule: true,
  dangerouslyDeleteByTag: jest.fn(),
  waitUntil: jest.fn(),
}));

const TAGS = ["places-16-24457-37226", "places-17-48915-74452"];

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();
});

// A purga que `forget` entregou ao `waitUntil`, para o teste esperar por ela.
function purgaEmAndamento() {
  return waitUntil.mock.calls[0][0];
}

describe("infra/cdn.js", () => {
  describe(".forget()", () => {
    test("with tags to forget", async () => {
      dangerouslyDeleteByTag.mockResolvedValue();

      cdn.forget(TAGS);
      await purgaEmAndamento();

      // APAGAR, e não invalidar — e sem o prazo de revalidação: com ele a
      // borda ainda entregaria a cópia velha a quem pedisse dentro do prazo.
      expect(dangerouslyDeleteByTag).toHaveBeenCalledTimes(1);
      expect(dangerouslyDeleteByTag).toHaveBeenCalledWith(TAGS);
    });

    // Quem chama não espera, e a resposta sai antes de a purga terminar: é o
    // `waitUntil` que impede a função de ser congelada no meio dela.
    test("without waiting for the purge", () => {
      let terminar;
      dangerouslyDeleteByTag.mockReturnValue(
        new Promise((resolve) => {
          terminar = resolve;
        }),
      );

      expect(cdn.forget(TAGS)).toBeUndefined();

      expect(waitUntil).toHaveBeenCalledTimes(1);
      expect(purgaEmAndamento()).toBeInstanceOf(Promise);
      terminar();
    });

    test("with a purge the CDN refuses", async () => {
      dangerouslyDeleteByTag.mockRejectedValue(new Error("purge failed"));

      cdn.forget(TAGS);

      // Não rejeita: o cardápio já está guardado, e a cópia velha da borda
      // vence sozinha.
      await expect(purgaEmAndamento()).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledWith({
        name: "CdnPurgeError",
        tags: TAGS,
        underlyingErrorName: "Error",
      });
    });

    test("with a purge that throws before returning a promise", async () => {
      dangerouslyDeleteByTag.mockImplementation(() => {
        throw new TypeError("purge is not a function");
      });

      expect(() => cdn.forget(TAGS)).not.toThrow();
      await expect(purgaEmAndamento()).resolves.toBeUndefined();
      expect(console.error).toHaveBeenCalledTimes(1);
    });
  });
});
