import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import AdminAuthShell from "components/admin/AdminAuthShell.js";
import { apiFetch } from "lib/adminApi.js";
import { checkAdminGuest } from "lib/adminAuth.js";

export async function getServerSideProps(context) {
  return await checkAdminGuest(context);
}

export default function AdminLogin({ isDev }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setErro(null);
    setCarregando(true);

    try {
      await apiFetch("/api/v1/admin/sessions", {
        method: "POST",
        body: { email, password },
      });
      document.cookie = "admin_dev_manual=; path=/; max-age=-1";
      router.push("/admin");
    } catch (error) {
      setErro(error.message);
      setCarregando(false);
    }
  }

  async function handleDevLogin() {
    setErro(null);
    setCarregando(true);
    try {
      await apiFetch("/api/v1/admin/dev-session", { method: "POST" });
      document.cookie = "admin_dev_manual=; path=/; max-age=-1";
      router.push("/admin");
    } catch (error) {
      setErro(error.message);
      setCarregando(false);
    }
  }

  return (
    <AdminAuthShell
      aba="Entrar no painel"
      titulo="Painel administrativo"
      subtitulo="Entre com uma conta administrativa autorizada."
    >
      {erro ? (
        <div className="adm-alert adm-alert-error" role="alert">
          {erro}
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <div className="adm-field">
          <label htmlFor="admin-email" className="adm-field-label">
            E-mail
          </label>
          <input
            id="admin-email"
            type="email"
            autoComplete="email"
            required
            className="adm-input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <div className="adm-field">
          <label htmlFor="admin-password" className="adm-field-label">
            Senha
          </label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            required
            className="adm-input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={carregando}
          className="adm-btn adm-btn-dark"
          style={{ width: "100%", marginTop: 4 }}
        >
          {carregando ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <div style={{ marginTop: 12, textAlign: "center" }}>
        <Link href="/admin/recuperar-senha" className="adm-link">
          Esqueci minha senha
        </Link>
      </div>

      {isDev ? (
        <div
          className="adm-alert adm-alert-info"
          style={{ marginTop: 14, marginBottom: 0 }}
        >
          <p style={{ margin: "0 0 4px", fontWeight: 600 }}>
            Ambiente de desenvolvimento
          </p>
          <p style={{ margin: "0 0 8px", fontSize: "0.75rem" }}>
            Credencial de teste:{" "}
            <span className="adm-mono">admin@menuspoiler.local</span> /{" "}
            <span className="adm-mono">devadminpassword</span>
          </p>
          <button
            type="button"
            disabled={carregando}
            onClick={handleDevLogin}
            className="adm-btn adm-btn-primary adm-btn-sm"
            style={{ width: "100%" }}
          >
            Entrar como admin de teste
          </button>
        </div>
      ) : null}
    </AdminAuthShell>
  );
}
