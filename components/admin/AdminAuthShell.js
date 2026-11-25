import Head from "next/head";
import { instrumentSans } from "lib/fonts.js";
import { CORES } from "lib/identidade.js";
import MarcaMenuSpoiler from "components/MarcaMenuSpoiler.js";

export default function AdminAuthShell({
  aba,
  titulo,
  subtitulo = null,
  children,
}) {
  return (
    <>
      <Head>
        <title>{`${aba} — Menu Spoiler`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="referrer" content="no-referrer" />
        <meta name="theme-color" content={CORES.azul} />
      </Head>

      <main className={`adm-auth-page ${instrumentSans.className}`}>
        <section className="adm-auth-card">
          <div style={{ marginBottom: 14 }}>
            <MarcaMenuSpoiler comoLink largura={118} />
          </div>
          <h1 className="adm-title" style={{ fontSize: "1.2rem" }}>
            {titulo}
          </h1>
          {subtitulo ? (
            <p className="adm-subtitle" style={{ marginBottom: 14 }}>
              {subtitulo}
            </p>
          ) : null}
          {children}
        </section>
      </main>
    </>
  );
}
