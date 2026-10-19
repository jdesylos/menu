import termos from "models/termos.js";

describe("models/termos.js", () => {
  describe(".blocos()", () => {
    test("reads titles, paragraphs and items like the app does", () => {
      const texto = [
        "Primeiro parágrafo,",
        "que continua na linha de baixo.",
        "",
        "# O que coletamos",
        "",
        "- Cadastro: nome e email.",
        "- Localização: usada para abrir o mapa",
        "  perto de você.",
        "",
        "Último parágrafo.",
      ].join("\n");

      expect(termos.blocos(texto)).toEqual([
        {
          tipo: "paragrafo",
          texto: "Primeiro parágrafo, que continua na linha de baixo.",
        },
        { tipo: "titulo", texto: "O que coletamos" },
        { tipo: "item", texto: "Cadastro: nome e email." },
        {
          tipo: "item",
          texto: "Localização: usada para abrir o mapa perto de você.",
        },
        { tipo: "paragrafo", texto: "Último parágrafo." },
      ]);
    });

    test("a title closes the paragraph right above it", () => {
      expect(termos.blocos("Texto\n# Título\nMais texto")).toEqual([
        { tipo: "paragrafo", texto: "Texto" },
        { tipo: "titulo", texto: "Título" },
        { tipo: "paragrafo", texto: "Mais texto" },
      ]);
    });
  });

  describe(".ler()", () => {
    test("reads the terms the app shows, with who answers for the data", () => {
      const lidos = termos.ler();

      expect(lidos[0].tipo).toBe("paragrafo");
      expect(lidos).toContainEqual({ tipo: "titulo", texto: "Seus direitos" });
      expect(lidos.map((bloco) => bloco.texto).join(" ")).toContain(
        "JBS DESIGN E MARKETING LTDA",
      );
    });
  });
});
