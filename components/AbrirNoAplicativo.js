import Head from "next/head";
import { useSyncExternalStore } from "react";
import { instrumentSans } from "lib/fonts.js";
import { CORES } from "lib/identidade.js";
import BotoesLojas from "components/BotoesLojas.js";
import MarcaMenuSpoiler from "components/MarcaMenuSpoiler.js";

// A página de um link que quem trata é o APLICATIVO — ativação, recuperação de
// senha ou abertura de um cardápio compartilhado.
//
// No celular com o Menu Spoiler instalado, o sistema entrega o link direto a
// ele (App Links no Android, Universal Links no iOS), e a página nem chega a
// abrir. Ela só aparece para quem abriu o endereço no computador ou num celular
// sem o aplicativo. Para ativação e recuperação, NUNCA chama a API nem aceita
// senhas pela web; para cardápios compartilhados, nunca exibe pratos ou preços
// na web e direciona para o aplicativo e as lojas.
//
// No Android, quando aplicável, o botão abre o aplicativo por `intent://`,
// para o caso de o sistema não ter confirmado o domínio e o navegador ter
// ficado com o link.

const PACOTE_ANDROID = "com.menuspoiler.app";
// O domínio do filtro do aplicativo. Fixo, e não o desta página: servida de um
// deploy de preview, ela montaria um endereço que o aplicativo não aceita.
const DOMINIO = "menuspoiler.com.br";

// O endereço que abre o aplicativo, ou `null` fora do Android.
//
// Lido no navegador, e não no servidor: é só lá que se sabe o aparelho, e a
// página sai igual para todo mundo. O caminho é o desta mesma página.
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

export default function AbrirNoAplicativo({
  aba,
  titulo,
  texto,
  descricao,
  mostrarLojas = false,
  podeAbrirNoApp = true,
  semReferrer = true,
}) {
  const abrir = useSyncExternalStore(
    semMudancas,
    enderecoNoAplicativo,
    () => null,
  );

  const resumo = descricao ?? texto;

  return (
    <>
      <Head>
        <title>{`${aba} — Menu Spoiler`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content={CORES.azul} />
        <meta name="description" content={resumo} />
        <meta property="og:title" content={`${aba} — Menu Spoiler`} />
        <meta property="og:description" content={resumo} />
        <meta property="og:locale" content="pt_BR" />
        {/* Em links com token na URL, evita vazamento pelo cabeçalho Referer. */}
        {semReferrer ? <meta name="referrer" content="no-referrer" /> : null}
        <meta name="robots" content="noindex" />
      </Head>
      <main className={`pagina ${instrumentSans.className}`}>
        <div className="marca-topo">
          <MarcaMenuSpoiler comoLink largura={140} />
        </div>
        <h1 className="titulo">{titulo}</h1>
        <p className="texto">{texto}</p>
        {podeAbrirNoApp && abrir ? (
          <a href={abrir} className="botao-app">
            Abrir no aplicativo
          </a>
        ) : null}
        {mostrarLojas ? (
          <section className="lojas" aria-label="Baixar o Menu Spoiler">
            <p className="lojas-titulo">Ainda não tem o aplicativo?</p>
            <BotoesLojas />
          </section>
        ) : null}
      </main>

      <style jsx global>{`
        html,
        body {
          margin: 0;
          background: ${CORES.papel};
        }
      `}</style>
      <style jsx>{`
        .pagina {
          box-sizing: border-box;
          max-width: 520px;
          margin: 0 auto;
          padding: 40px 20px 64px;
          color: ${CORES.tinta};
          -webkit-font-smoothing: antialiased;
        }

        .marca-topo {
          margin-bottom: 32px;
        }

        .titulo {
          font-size: clamp(1.5rem, 1.25rem + 1vw, 1.875rem);
          font-weight: 600;
          line-height: 1.15;
          letter-spacing: -0.02em;
          margin: 0 0 12px;
        }

        .texto {
          font-size: 1rem;
          line-height: 1.55;
          color: ${CORES.apoio};
          margin: 0 0 28px;
        }

        .botao-app {
          display: block;
          padding: 15px 18px;
          border-radius: 14px;
          background: ${CORES.azul};
          color: ${CORES.tinta};
          text-align: center;
          text-decoration: none;
          font-weight: 600;
          margin-bottom: 24px;
        }

        .botao-app:focus-visible {
          outline: 2px solid ${CORES.tinta};
          outline-offset: 3px;
        }

        .lojas {
          padding-top: 20px;
          border-top: 1px solid #e3e9ed;
        }

        .lojas-titulo {
          margin: 0 0 12px;
          font-size: 0.9375rem;
          font-weight: 600;
          color: ${CORES.tinta};
        }
      `}</style>
    </>
  );
}
