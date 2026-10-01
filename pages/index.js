import Head from "next/head";
import localFont from "next/font/local";

// A home é PROVISÓRIA: uma tela só, que diz o que o Menu Spoiler é e que ele
// ainda não está em loja nenhuma. Ela existe porque o domínio já está no ar, e
// quem o digita merece mais que o JSON que morava aqui.
//
// As lojas aparecem como frase, e não como botão: selo que não leva a lugar
// nenhum faz a pessoa concluir que o site está quebrado. Quando o aplicativo
// for publicado, a frase vira os dois links.
//
// Nada aqui fala com a API nem com o banco — a página sai estática.

// A letra é a do aplicativo, servida daqui mesmo: fonte de terceiro seria uma
// requisição a outro site só para desenhar o título.
const instrumentSans = localFont({
  src: [
    { path: "../assets/InstrumentSans-Regular.ttf", weight: "400" },
    { path: "../assets/InstrumentSans-SemiBold.ttf", weight: "600" },
  ],
  display: "swap",
});

const TITULO = "O cardápio antes de você chegar.";
const DESCRICAO =
  "Um aplicativo que mostra os pratos e os preços dos lugares perto de você. E se o cardápio ainda não estiver lá, é só fotografar.";
const LOJAS = "Em breve para Android e iOS.";

// A folha é ilustração: três linhas de cardápio, com o preço escondido atrás
// de uma tarja que sai sozinha — o "spoiler" do nome. Não vem do banco, e por
// isso os pratos são os de qualquer esquina de São Paulo, sem casa nenhuma.
const PRATOS = [
  { nome: "Virado à paulista", preco: "R$ 42,00" },
  { nome: "Pastel de feira", preco: "R$ 12,00" },
  { nome: "Caldo de cana", preco: "R$ 9,00" },
];

export default function Home() {
  return (
    <>
      <Head>
        <title>Menu Spoiler — o cardápio antes de você chegar</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content={`${DESCRICAO} ${LOJAS}`} />
        <meta name="theme-color" content="#1FB2E8" />
        <meta property="og:title" content="Menu Spoiler" />
        <meta property="og:description" content={TITULO} />
        <meta property="og:locale" content="pt_BR" />
      </Head>
      {/* O idioma vai aqui, e não no <html>, para não criar um `_document`
          que mudaria as outras páginas junto. */}
      <main lang="pt-BR" className={`pagina ${instrumentSans.className}`}>
        <p className="marca">Menu Spoiler</p>

        <div className="conteudo">
          <h1 className="titulo">{TITULO}</h1>
          <p className="texto">{DESCRICAO}</p>
          <div
            className="folha"
            role="img"
            aria-label="Exemplo de cardápio, com três pratos e o preço de cada um."
          >
            {PRATOS.map((prato) => (
              <div className="prato" key={prato.nome}>
                <span className="nome">{prato.nome}</span>
                <span className="guia" />
                <span className="preco">{prato.preco}</span>
              </div>
            ))}
          </div>
          <p className="lojas">{LOJAS}</p>
        </div>

        <footer className="rodape">
          <span>JBS Design e Marketing Ltda</span>
          <span>CNPJ 67.260.094/0001-09</span>
        </footer>
      </main>

      <style jsx global>{`
        html,
        body {
          margin: 0;
          background: #1fb2e8;
        }
      `}</style>
      <style jsx>{`
        /* As cores são as do ui::theme do aplicativo: PRIMARIA, TEXTO, CARD e
           TEXTO_MARCADOR. */
        .pagina {
          --azul: #1fb2e8;
          --tinta: #0e1d26;
          --papel: #ffffff;
          --guia: #8a98a2;
          --lado: clamp(20px, 6vw, 72px);

          box-sizing: border-box;
          /* A tela inteira, e nunca mais que ela: é o que dispensa a rolagem.
             É mínimo, e não altura fixa, para que numa janela baixa demais o
             conteúdo role em vez de ser cortado. */
          min-height: 100vh;
          min-height: 100dvh;
          display: grid;
          grid-template-rows: auto 1fr auto;
          row-gap: clamp(16px, 3vh, 32px);
          padding: clamp(20px, 4vh, 44px)
            max(var(--lado), calc((100vw - 1120px) / 2));
          background: var(--azul);
          color: var(--tinta);
          -webkit-font-smoothing: antialiased;
        }

        .marca {
          margin: 0;
          font-size: 1.375rem;
          font-weight: 600;
          letter-spacing: -0.02em;
        }

        .conteudo {
          display: grid;
          align-content: center;
          row-gap: clamp(14px, 2.6vh, 28px);
        }

        .titulo {
          margin: 0;
          font-size: clamp(2rem, min(10vw, 8vh), 3.5rem);
          font-weight: 600;
          line-height: 0.98;
          letter-spacing: -0.035em;
          text-wrap: balance;
        }

        .texto,
        .lojas {
          margin: 0;
          max-width: 30em;
          font-size: clamp(1.0625rem, 0.95rem + 0.45vw, 1.3125rem);
          line-height: 1.45;
        }

        .lojas {
          font-weight: 600;
        }

        /* A folha mede em em: a largura e o respiro acompanham a letra dela,
           e a linha pontilhada nunca some entre o prato e o preço. */
        .folha {
          box-sizing: border-box;
          display: grid;
          row-gap: clamp(10px, 1.6vh, 18px);
          width: 100%;
          max-width: 24em;
          padding: 1.1em 1.3em;
          border-radius: 20px;
          background: var(--papel);
          font-size: clamp(1.0625rem, 0.95rem + 0.5vw, 1.25rem);
          transform: rotate(-2deg);
        }

        .prato {
          display: flex;
          align-items: baseline;
          gap: 10px;
        }

        .nome {
          font-weight: 600;
          white-space: nowrap;
        }

        /* A linha pontilhada que leva o olho do prato ao preço. */
        .guia {
          flex: 1;
          min-width: 16px;
          border-bottom: 2px dotted var(--guia);
        }

        .preco {
          position: relative;
          white-space: nowrap;
          font-variant-numeric: tabular-nums;
        }

        .preco::after {
          content: "";
          position: absolute;
          inset: 0 -0.3em;
          border-radius: 4px;
          background: var(--tinta);
          transform-origin: right center;
          animation: revelar-preco 520ms cubic-bezier(0.7, 0, 0.2, 1) both;
        }

        .prato:nth-child(1) .preco::after {
          animation-delay: 700ms;
        }

        .prato:nth-child(2) .preco::after {
          animation-delay: 920ms;
        }

        .prato:nth-child(3) .preco::after {
          animation-delay: 1140ms;
        }

        @keyframes revelar-preco {
          from {
            transform: scaleX(1);
          }
          to {
            transform: scaleX(0);
          }
        }

        .rodape {
          display: flex;
          flex-wrap: wrap;
          gap: 2px 20px;
          font-size: 0.875rem;
          line-height: 1.4;
        }

        /* Em tela larga, o texto fica à esquerda e a folha ao lado dele. */
        @media (min-width: 900px) {
          .conteudo {
            grid-template-columns: minmax(0, 1fr) auto;
            grid-template-areas:
              "titulo folha"
              "texto folha"
              "lojas folha";
            column-gap: clamp(32px, 6vw, 96px);
          }

          .titulo {
            grid-area: titulo;
            font-size: clamp(2.5rem, min(6.2vw, 12vh), 5.25rem);
          }

          .texto {
            grid-area: texto;
          }

          .lojas {
            grid-area: lojas;
          }

          /* Ao lado de um título deste tamanho, a folha cresce junto. */
          .folha {
            grid-area: folha;
            align-self: center;
            row-gap: clamp(12px, 2.2vh, 24px);
            width: 19em;
            padding: 1.4em 1.5em;
            font-size: clamp(1rem, 0.35rem + 1.3vw, 1.625rem);
          }
        }

        /* Janela baixa, como a do celular deitado: a folha é o que sai, porque
           é a única coisa da página que não informa nada. */
        @media (max-width: 899px) and (max-height: 520px) {
          .folha {
            display: none;
          }
        }

        /* Quem pediu menos movimento já encontra o preço à mostra. */
        @media (prefers-reduced-motion: reduce) {
          .preco::after {
            display: none;
          }
        }
      `}</style>
    </>
  );
}
