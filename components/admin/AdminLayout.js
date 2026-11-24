import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import { instrumentSans } from "lib/fonts.js";
import { CORES } from "lib/identidade.js";
import { apiFetch } from "lib/adminApi.js";
import MarcaMenuSpoiler from "components/MarcaMenuSpoiler.js";

export default function AdminLayout({
  titulo,
  subtitulo = null,
  adminUser,
  forbidden = false,
  forbiddenMessage = null,
  acoes = null,
  showPageHeader = true,
  children,
}) {
  const router = useRouter();
  const [saindo, setSaindo] = useState(false);

  const isCockpit = router.pathname === "/admin";

  async function handleLogout() {
    setSaindo(true);
    try {
      await apiFetch("/api/v1/admin/sessions", { method: "DELETE" });
    } catch {
      // Mesmo se a sessão já expirou, volta ao login.
    }
    if (typeof document !== "undefined") {
      document.cookie =
        "admin_dev_manual=1; path=/; max-age=3600; SameSite=Lax";
    }
    router.push("/admin/login");
  }

  return (
    <>
      <Head>
        <title>{`${titulo} — Painel Menu Spoiler`}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <meta name="theme-color" content={CORES.azul} />
      </Head>

      <div className={`adm-shell ${instrumentSans.className}`}>
        <a href="#adm-main-content" className="adm-skip-link">
          Pular para o conteúdo
        </a>
        <header className="adm-topbar">
          <div className="adm-brand">
            <MarcaMenuSpoiler comoLink largura={94} />
            <span className="adm-badge-role">Painel admin</span>
            {!isCockpit && !forbidden ? (
              <Link href="/admin" className="adm-nav-link">
                ← Central
              </Link>
            ) : null}
          </div>

          <div className="adm-user-bar">
            {adminUser?.username ? (
              <span className="adm-user-name">{adminUser.username}</span>
            ) : null}
            <button
              type="button"
              onClick={handleLogout}
              disabled={saindo}
              className="adm-btn adm-btn-secondary adm-btn-sm"
            >
              {saindo ? "Saindo…" : "Sair"}
            </button>
          </div>
        </header>

        <main id="adm-main-content" className="adm-main">
          {forbidden ? (
            <section className="adm-card" role="alert">
              <h1 className="adm-title">Acesso não autorizado</h1>
              <p className="adm-subtitle">
                {forbiddenMessage ||
                  "Esta conta não possui permissão para acessar o painel."}
              </p>
              <div className="adm-row" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={saindo}
                  className="adm-btn adm-btn-primary adm-btn-sm"
                >
                  Entrar com outra conta
                </button>
              </div>
            </section>
          ) : (
            <>
              {showPageHeader ? (
                <div className="adm-pagebar">
                  <div className="adm-pagebar-left">
                    <h1 className="adm-title">{titulo}</h1>
                    {subtitulo ? (
                      <p className="adm-submeta">{subtitulo}</p>
                    ) : null}
                  </div>
                  {acoes ? <div className="adm-row">{acoes}</div> : null}
                </div>
              ) : (
                <h1 className="adm-sr-only">{titulo}</h1>
              )}
              {children}
            </>
          )}
        </main>
      </div>
    </>
  );
}
