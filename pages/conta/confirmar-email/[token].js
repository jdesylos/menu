import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import AdminAuthShell from "components/admin/AdminAuthShell.js";
import { apiFetch } from "lib/adminApi.js";

export default function ConfirmarNovoEmail() {
  const router = useRouter();
  const token = router.query.token;

  const [dados, setDados] = useState(null);
  const [erro, setErro] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [confirmando, setConfirmando] = useState(false);
  const [concluido, setConcluido] = useState(null);

  useEffect(() => {
    if (!router.isReady || !token) return;
    let ativo = true;

    apiFetch(`/api/v1/email-changes/${encodeURIComponent(token)}`)
      .then((res) => {
        if (ativo) {
          setDados(res);
          setCarregando(false);
        }
      })
      .catch((error) => {
        if (ativo) {
          setErro(error.message);
          setCarregando(false);
        }
      });

    return () => {
      ativo = false;
    };
  }, [router.isReady, token]);

  async function handleConfirm() {
    setErro(null);
    setConfirmando(true);
    try {
      const updated = await apiFetch(
        `/api/v1/email-changes/${encodeURIComponent(token)}`,
        { method: "PATCH" },
      );
      setConcluido(updated.email);
    } catch (error) {
      setErro(error.message);
    } finally {
      setConfirmando(false);
    }
  }

  return (
    <AdminAuthShell
      aba="Confirmar alteração de e-mail"
      titulo="Confirmar novo e-mail"
      subtitulo="Conclua a atualização do endereço vinculado à conta."
    >
      {carregando ? <p className="adm-muted">Validando link...</p> : null}

      {erro ? (
        <div className="adm-alert adm-alert-error" role="alert">
          {erro}
        </div>
      ) : null}

      {concluido ? (
        <div className="adm-alert adm-alert-success" role="status">
          E-mail alterado com sucesso para <strong>{concluido}</strong>.
        </div>
      ) : null}

      {!carregando && dados && !concluido ? (
        <>
          <div className="adm-alert adm-alert-info">
            Novo endereço a confirmar: <strong>{dados.new_email}</strong>
          </div>
          <button
            type="button"
            disabled={confirmando}
            onClick={handleConfirm}
            className="adm-btn adm-btn-dark"
            style={{ width: "100%" }}
          >
            {confirmando ? "Confirmando..." : "Confirmar novo e-mail"}
          </button>
        </>
      ) : null}
    </AdminAuthShell>
  );
}
