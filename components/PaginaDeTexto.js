import Head from "next/head";
import Link from "next/link";
import localFont from "next/font/local";

// A página de LER: os termos e o caminho para apagar a conta, que as lojas
// pedem num endereço público e que qualquer um precisa conseguir ler no
// celular. Fundo claro e coluna estreita, ao contrário da home, que é uma
// tela só — mas com a letra, a marca e o rodapé dela.
//
// Nada aqui fala com a API nem com o banco: as páginas saem estáticas.

// A letra do aplicativo, servida daqui mesmo, como na home.
const instrumentSans = localFont({
  src: [
    { path: "../assets/InstrumentSans-Regular.ttf", weight: "400" },
    { path: "../assets/InstrumentSans-SemiBold.ttf", weight: "600" },
  ],
  display: "swap",
});

export default function PaginaDeTexto({ aba, descricao, titulo, children }) {
  return (
    <>
      <Head>
        <title>{`${aba} — Menu Spoiler`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={descricao} />
        <meta name="theme-color" content="#1FB2E8" />
      </Head>
      <div lang="pt-BR" className={`pagina ${instrumentSans.className}`}>
        <header className="topo">
          <Link href="/" className="marca">
            Menu Spoiler
          </Link>
        </header>

        <main className="conteudo">
          <h1 className="titulo">{titulo}</h1>
          {children}
        </main>

        <footer className="rodape">
          <nav className="links" aria-label="Páginas do Menu Spoiler">
            <Link href="/privacidade">Termos e privacidade</Link>
            <Link href="/conta/apagar">Apagar a conta</Link>
          </nav>
          <span>JBS Design e Marketing Ltda</span>
          <span>CNPJ 67.260.094/0001-09</span>
        </footer>
      </div>

      <style jsx global>{`
        html,
        body {
          margin: 0;
          background: #ffffff;
        }
      `}</style>
      <style jsx>{`
        /* As cores são as do ui::theme do aplicativo: PRIMARIA, TEXTO,
           TEXTO_FRACO e FUNDO_DA_LISTA. */
        .pagina {
          --azul: #1fb2e8;
          --tinta: #0e1d26;
          --apoio: #6c7c87;
          --fundo: #eff4f7;
          --lado: 16px;

          min-height: 100vh;
          min-height: 100dvh;
          display: grid;
          grid-template-rows: auto 1fr auto;
          color: var(--tinta);
          -webkit-font-smoothing: antialiased;
        }

        .topo {
          padding: 20px max(var(--lado), calc((100vw - 720px) / 2));
          background: var(--azul);
        }

        .topo :global(.marca) {
          color: var(--tinta);
          font-size: 1.375rem;
          font-weight: 600;
          letter-spacing: -0.02em;
          text-decoration: none;
        }

        .conteudo {
          box-sizing: border-box;
          width: 100%;
          max-width: calc(720px + 2 * var(--lado));
          margin: 0 auto;
          padding: 40px var(--lado) 56px;
          font-size: 1.0625rem;
          line-height: 1.6;
          overflow-wrap: break-word;
        }

        .titulo {
          margin: 0 0 24px;
          font-size: clamp(1.75rem, 1.4rem + 1.6vw, 2.5rem);
          font-weight: 600;
          line-height: 1.1;
          letter-spacing: -0.03em;
          text-wrap: balance;
        }

        .conteudo :global(h2) {
          margin: 36px 0 8px;
          font-size: 1.25rem;
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        .conteudo :global(p),
        .conteudo :global(ul),
        .conteudo :global(ol) {
          margin: 0 0 14px;
        }

        .conteudo :global(ul),
        .conteudo :global(ol) {
          padding-left: 1.25em;
        }

        .conteudo :global(li) {
          margin-bottom: 8px;
        }

        .conteudo :global(li::marker) {
          color: var(--azul);
          font-weight: 600;
        }

        .conteudo :global(a) {
          color: var(--tinta);
          text-decoration-color: var(--azul);
          text-decoration-thickness: 2px;
          text-underline-offset: 3px;
        }

        .rodape {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 20px;
          padding: 24px max(var(--lado), calc((100vw - 720px) / 2));
          background: var(--fundo);
          color: var(--apoio);
          font-size: 0.875rem;
          line-height: 1.4;
        }

        .links {
          display: flex;
          flex-wrap: wrap;
          gap: 4px 20px;
          width: 100%;
          margin-bottom: 8px;
        }

        .links :global(a) {
          color: var(--tinta);
          font-weight: 600;
        }
      `}</style>
    </>
  );
}
