import Image from "next/image";
import Link from "next/link";
import { CORES } from "lib/identidade.js";

// A marca oficial exportada do arquivo da logo. Como o "$poiler" usa o mesmo
// ciano do fundo principal, sobre o azul ela ganha uma etiqueta branca — como
// a folha de cardápio da home — para manter contraste e legibilidade.
export default function MarcaMenuSpoiler({
  comoLink = false,
  sobreFundoAzul = false,
  largura = 156,
}) {
  const imagem = (
    <Image
      src="/logo-menu-spoiler.png"
      alt="Menu Spoiler"
      width={863}
      height={403}
      priority
      sizes={`${largura}px`}
      style={{
        display: "block",
        width: largura,
        maxWidth: "100%",
        height: "auto",
      }}
    />
  );

  const classe = sobreFundoAzul ? "marca sobre-azul" : "marca";

  return (
    <>
      {comoLink ? (
        <Link href="/" className={classe} aria-label="Menu Spoiler — início">
          {imagem}
        </Link>
      ) : (
        <div className={classe}>{imagem}</div>
      )}

      <style jsx>{`
        .marca {
          display: inline-flex;
          align-items: center;
          width: fit-content;
          text-decoration: none;
        }

        .sobre-azul {
          padding: 8px 14px;
          border-radius: 16px;
          background: ${CORES.papel};
        }

        :global(a.marca:focus-visible) {
          outline: 2px solid ${CORES.tinta};
          outline-offset: 4px;
          border-radius: 16px;
        }
      `}</style>
    </>
  );
}
