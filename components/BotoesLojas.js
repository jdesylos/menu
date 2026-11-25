import { CORES, LOJAS } from "lib/identidade.js";

function IconeApple() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16.37 12.64c-.02-2.06 1.68-3.05 1.76-3.1-.96-1.4-2.45-1.59-2.98-1.61-1.26-.13-2.47.74-3.11.74-.64 0-1.63-.72-2.69-.7-1.38.02-2.66.8-3.37 2.04-1.44 2.5-.37 6.2 1.03 8.23.69 1 1.51 2.11 2.59 2.07 1.04-.04 1.43-.67 2.69-.67 1.25 0 1.61.67 2.7.65 1.12-.02 1.83-1.01 2.51-2.01.79-1.16 1.12-2.29 1.14-2.35-.03-.01-2.18-.84-2.27-3.29zM14.32 6.58c.57-.69.96-1.65.85-2.61-.82.03-1.82.55-2.41 1.24-.52.61-.98 1.59-.86 2.53.92.07 1.85-.47 2.42-1.16z"
      />
    </svg>
  );
}

function IconeGooglePlay() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4.6 3.2c-.35.2-.6.62-.6 1.17v15.26c0 .55.25.97.6 1.17l.1.06 8.55-8.55v-.2L4.7 3.14l-.1.06zm11.4 11.4-2.85-2.85v-.2l2.85-2.85.07.04 3.38 1.92c.96.55.96 1.45 0 2l-3.38 1.92-.07.02zM15.96 14.56l-2.71-2.71L4.6 20.5c.32.34.86.38 1.47.03l9.89-5.97zm0-5.12L6.07 3.47c-.61-.35-1.15-.31-1.47.03l8.65 8.65 2.71-2.71z"
      />
    </svg>
  );
}

const ICONES = {
  apple: <IconeApple />,
  google: <IconeGooglePlay />,
};

// Botões das duas lojas onde o aplicativo está publicado. Reutilizado na home e
// nas páginas de abertura de link para manter aparência e comportamento iguais.
export default function BotoesLojas() {
  return (
    <>
      <div className="grade" role="group" aria-label="Baixar o aplicativo">
        {LOJAS.map((loja) => (
          <a
            key={loja.id}
            href={loja.url}
            target="_blank"
            rel="noopener noreferrer"
            className="botao"
            aria-label={loja.ariaLabel}
          >
            <span className="icone">{ICONES[loja.id]}</span>
            <span className="rotulos">
              <span className="chamada">{loja.chamada}</span>
              <span className="nome">{loja.nome}</span>
            </span>
          </a>
        ))}
      </div>

      <style jsx>{`
        .grade {
          display: flex;
          flex-wrap: wrap;
          gap: 12px;
        }

        .botao {
          display: inline-flex;
          align-items: center;
          gap: 11px;
          padding: 11px 18px;
          border-radius: 14px;
          background: ${CORES.tinta};
          color: ${CORES.papel};
          text-decoration: none;
          transition:
            transform 140ms ease,
            opacity 140ms ease;
        }

        .botao:hover {
          opacity: 0.92;
          transform: translateY(-1px);
        }

        .botao:active {
          transform: translateY(0);
        }

        .botao:focus-visible {
          outline: 2px solid ${CORES.tinta};
          outline-offset: 3px;
        }

        .icone {
          display: inline-flex;
          flex-shrink: 0;
        }

        .rotulos {
          display: flex;
          flex-direction: column;
          line-height: 1.15;
        }

        .chamada {
          font-size: 0.6875rem;
          font-weight: 400;
          letter-spacing: 0.01em;
          opacity: 0.85;
        }

        .nome {
          font-size: 1rem;
          font-weight: 600;
          letter-spacing: -0.01em;
        }

        @media (prefers-reduced-motion: reduce) {
          .botao {
            transition: none;
          }

          .botao:hover {
            transform: none;
          }
        }
      `}</style>
    </>
  );
}
