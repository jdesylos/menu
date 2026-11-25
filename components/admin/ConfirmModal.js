import { useEffect, useState } from "react";

export default function ConfirmModal({
  aberto,
  titulo,
  mensagem,
  textoConfirmar = "Confirmar",
  perigoso = true,
  exigirTexto = null,
  carregando = false,
  onConfirmar,
  onCancelar,
}) {
  const [digitado, setDigitado] = useState("");

  useEffect(() => {
    if (!aberto) return;
    function onKey(event) {
      if (event.key === "Escape" && !carregando) {
        onCancelar();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [aberto, carregando, onCancelar]);

  if (!aberto) return null;

  const pronto =
    !exigirTexto ||
    digitado.trim().toLowerCase() === exigirTexto.trim().toLowerCase();

  function fechar() {
    setDigitado("");
    onCancelar();
  }

  function confirmar() {
    setDigitado("");
    onConfirmar();
  }

  return (
    <div
      className="adm-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="adm-confirm-title"
    >
      <div className="adm-modal">
        <h2
          id="adm-confirm-title"
          className="adm-card-title"
          style={{ marginBottom: 4 }}
        >
          {titulo}
        </h2>
        <p className="adm-subtitle" style={{ marginBottom: 12 }}>
          {mensagem}
        </p>

        {exigirTexto ? (
          <div className="adm-field">
            <label htmlFor="adm-confirm-input" className="adm-field-label">
              Digite <strong>{exigirTexto}</strong> para confirmar:
            </label>
            <input
              id="adm-confirm-input"
              type="text"
              className="adm-input"
              value={digitado}
              onChange={(event) => setDigitado(event.target.value)}
              autoFocus
            />
          </div>
        ) : null}

        <div className="adm-row" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            className="adm-btn adm-btn-secondary adm-btn-sm"
            onClick={fechar}
            disabled={carregando}
          >
            Cancelar
          </button>
          <button
            type="button"
            className={
              perigoso
                ? "adm-btn adm-btn-danger adm-btn-sm"
                : "adm-btn adm-btn-primary adm-btn-sm"
            }
            onClick={confirmar}
            disabled={!pronto || carregando}
          >
            {carregando ? "Processando..." : textoConfirmar}
          </button>
        </div>
      </div>
    </div>
  );
}
