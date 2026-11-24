import Link from "next/link";
import { useState } from "react";
import AdminAuthShell from "components/admin/AdminAuthShell.js";
import { apiFetch } from "lib/adminApi.js";

export default function AdminSolicitarRecuperacao() {
  const [email, setEmail] = useState("");
  const [mensagem, setMensagem] = useState(null);
  const [erro, setErro] = useState(null);
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    setErro(null);
    setMensagem(null);
    setEnviando(true);

    try {
      const response = await apiFetch("/api/v1/admin/recoveries", {
        method: "POST",
        body: { email },
      });
      setMensagem(response.message);
    } catch (error) {
      setErro(error.message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AdminAuthShell
      aba="Recuperar senha administrativa"
      titulo="Recuperar acesso ao painel"
      subtitulo="Informe o e-mail da sua conta administrativa para receber o link de redefinição."
    >
      {erro ? (
        <div className="adm-alert adm-alert-error" role="alert">
          {erro}
        </div>
      ) : null}
      {mensagem ? (
        <div className="adm-alert adm-alert-success" role="status">
          {mensagem}
        </div>
      ) : null}

      <form onSubmit={handleSubmit}>
        <div className="adm-field">
          <label htmlFor="rec-email" className="adm-field-label">
            E-mail administrativo
          </label>
          <input
            id="rec-email"
            type="email"
            required
            className="adm-input"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={enviando}
          className="adm-btn adm-btn-dark"
          style={{ width: "100%" }}
        >
          {enviando ? "Enviando..." : "Enviar link de recuperação"}
        </button>
      </form>

      <div style={{ marginTop: 16, textAlign: "center" }}>
        <Link href="/admin/login" className="adm-link">
          Voltar para o login
        </Link>
      </div>
    </AdminAuthShell>
  );
}
