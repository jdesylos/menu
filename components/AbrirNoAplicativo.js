import Head from "next/head";
import { useSyncExternalStore } from "react";

// A página de um link que quem trata é o APLICATIVO — o de ativação e o de
// recuperação de senha.
//
// No celular com o Menu Spoiler instalado, o sistema entrega o link direto a
// ele (App Links no Android, Universal Links no iOS), e a página nem chega a
// abrir. Ela só aparece para quem abriu o email em outro lugar — no
// computador, ou num celular sem o aplicativo. Aí ela explica onde abrir, e
// NUNCA chama a API: resolver o link pela web é o fluxo que se decidiu não
// ter, e um pré-visualizador de links que buscasse o endereço gastaria o
// token no lugar da pessoa.
//
// No Android, o botão abre o aplicativo por `intent://`, para o caso de o
// sistema não ter confirmado o domínio e o navegador ter ficado com o link.

const PACOTE_ANDROID = "com.menuspoiler.app";
// O domínio do filtro do aplicativo — o do link do email. Fixo, e não o
// desta página: servida de um deploy de preview, ela montaria um endereço
// que o aplicativo não aceita.
const DOMINIO = "menuspoiler.com.br";

// O endereço que abre o aplicativo, ou `null` fora do Android.
//
// Lido no navegador, e não no servidor: é só lá que se sabe o aparelho, e a
// página sai igual para todo mundo. O caminho é o desta mesma página, que é
// o do link do email.
function enderecoNoAplicativo() {
  if (!/Android/i.test(navigator.userAgent)) {
    return null;
  }
  return `intent://${DOMINIO}${window.location.pathname}#Intent;scheme=https;package=${PACOTE_ANDROID};end`;
}

// Nada disso muda com a página aberta.
function semMudancas() {
  return () => {};
}

export default function AbrirNoAplicativo({ aba, titulo, texto }) {
  const abrir = useSyncExternalStore(
    semMudancas,
    enderecoNoAplicativo,
    () => null,
  );

  return (
    <>
      <Head>
        <title>{`${aba} — Menu Spoiler`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        {/* O token está no endereço: nada daqui vai para outro site. */}
        <meta name="referrer" content="no-referrer" />
        <meta name="robots" content="noindex" />
      </Head>
      <main style={estilos.pagina}>
        <h1 style={estilos.titulo}>{titulo}</h1>
        <p style={estilos.texto}>{texto}</p>
        {abrir ? (
          <a href={abrir} style={estilos.botao}>
            Abrir no aplicativo
          </a>
        ) : null}
      </main>
    </>
  );
}

const estilos = {
  pagina: {
    maxWidth: 480,
    margin: "0 auto",
    padding: "64px 16px",
    fontFamily: "system-ui, sans-serif",
    color: "#0E1D26",
  },
  titulo: {
    fontSize: 24,
    margin: "0 0 12px",
  },
  texto: {
    fontSize: 16,
    lineHeight: 1.5,
    color: "#6C7C87",
    margin: "0 0 24px",
  },
  botao: {
    display: "block",
    padding: "16px",
    borderRadius: 12,
    background: "#1FB2E8",
    color: "#FFFFFF",
    textAlign: "center",
    textDecoration: "none",
    fontWeight: 600,
  },
};
