import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import AdminAuthShell from "components/admin/AdminAuthShell.js";
import { apiFetch } from "lib/adminApi.js";

export default function AdminRedefinirSenha() {
  const router = useRouter();
  const token = router.query.token;

  const [verificando, setVerificando] = useState(true);
  const [tokenValido, setTokenValido] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!router.isReady || !token) return;
    let ativo = true;

    apiFetch(`/api/v1/admin/recoveries/${encodeURIComponent(token)}`)
      .then(() => {
        if (ativo) {
          setTokenValido(true);
          setVerificando(false);
        }
      })
      .catch((error) => {
        if (ativo) {
          setErro(error.message);
          setVerificando(false);
        }
      });

    return () => {
      ativo = false;
    };
  }, [router.isReady, token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setErro(null);

    if (password !== confirmPassword) {
      setErro("As senhas digitadas não conferem.");
      return;
    }

    setSalvando(true);
    try {
      await apiFetch(`/api/v1/admin/recoveries/${encodeURIComponent(token)}`, {
        method: "PATCH",
        body: { password },
      });
      setSucesso(true);
    } catch (error) {
      setErro(error.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <AdminAuthShell
      aba="Nova senha administrativa"
      titulo="Definir nova senha"
      subtitulo="Escolha uma senha forte de 8 a 72 caracteres para o painel."
    >
      {verificando ? (
        <p className="adm-muted">Validando link de recuperação...</p>
      ) : null}

      {erro ? (
        <div className="adm-alert adm-alert-error" role="alert">
          {erro}
        </div>
      ) : null}

      {sucesso ? (
        <>
          <div className="adm-alert adm-alert-success" role="status">
            Senha redefinida com sucesso. Todas as sessões anteriores foram
            encerradas.
          </div>
          <Link
            href="/admin/login"
            className="adm-btn adm-btn-dark"
            style={{ width: "100%", boxSizing: "border-box" }}
          >
            Entrar no painel
          </Link>
        </>
      ) : null}

      {!verificando && tokenValido && !sucesso ? (
        <form onSubmit={handleSubmit}>
          <div className="adm-field">
            <label htmlFor="nova-senha" className="adm-field-label">
              Nova senha
            </label>
            <input
              id="nova-senha"
              type="password"
              required
              minLength={8}
              maxLength={72}
              className="adm-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>

          <div className="adm-field">
            <label htmlFor="confirma-senha" className="adm-field-label">
              Repita a nova senha
            </label>
            <input
              id="confirma-senha"
              type="password"
              required
              minLength={8}
              maxLength={72}
              className="adm-input"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
            />
          </div>

          <button
            type="submit"
            disabled={salvando}
            className="adm-btn adm-btn-dark"
            style={{ width: "100%" }}
          >
            {salvando ? "Salvando..." : "Salvar nova senha"}
          </button>
        </form>
      ) : null}

      {!verificando && !tokenValido && !sucesso ? (
        <Link href="/admin/recuperar-senha" className="adm-link">
          Solicitar um novo link
        </Link>
      ) : null}
    </AdminAuthShell>
  );
}
