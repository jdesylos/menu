import { readFileSync } from "node:fs";
import { join } from "node:path";

// Os termos de uso, que são também a política de privacidade.
//
// O texto nasce no aplicativo (assets/termos.txt do menuspoiler), que o mostra
// no cadastro, e `assets/termos.txt` daqui é uma CÓPIA dele: a página
// /privacidade precisa do mesmo texto que a pessoa aceitou. Mudou lá, copia
// aqui — nenhum dos dois repositórios enxerga o outro para conferir.
//
// O formato é o do aplicativo, e a leitura também (`ui::termos::blocos`): um
// bloco por parágrafo, separados por linha em branco; "# " abre um título,
// "- " abre um item; a linha seguinte sem marca continua o bloco aberto.

function blocos(texto) {
  const lidos = [];
  // O bloco que ainda pode crescer com a linha seguinte.
  let aberto = null;

  for (const linhaCrua of texto.split("\n")) {
    const linha = linhaCrua.trim();

    if (linha === "") {
      if (aberto) lidos.push(aberto);
      aberto = null;
      continue;
    }
    if (linha.startsWith("# ")) {
      if (aberto) lidos.push(aberto);
      aberto = null;
      lidos.push({ tipo: "titulo", texto: linha.slice(2).trim() });
      continue;
    }
    if (linha.startsWith("- ")) {
      if (aberto) lidos.push(aberto);
      aberto = { tipo: "item", texto: linha.slice(2).trim() };
      continue;
    }
    if (aberto) {
      aberto.texto = `${aberto.texto} ${linha}`;
    } else {
      aberto = { tipo: "paragrafo", texto: linha };
    }
  }
  if (aberto) lidos.push(aberto);

  return lidos;
}

// Lido na montagem da página, e não a cada visita: o texto só muda com um
// deploy.
function ler() {
  const texto = readFileSync(join(process.cwd(), "assets", "termos.txt"), {
    encoding: "utf8",
  });
  return blocos(texto);
}

const termos = {
  blocos,
  ler,
};

export default termos;
