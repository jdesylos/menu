import { useState } from "react";
import PanelCard, { UserCircleIcon } from "components/admin/PanelCard.js";
import { apiFetch, FEATURE_LABELS } from "lib/adminApi.js";

export default function AccountCockpitPanel({ adminUser }) {
  const [alterandoSenha, setAlterandoSenha] = useState(false);
  const [verPermissoes, setVerPermissoes] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const activeFeatures = (adminUser?.features || []).filter(
    (f) => FEATURE_LABELS[f],
  );

  function fecharFormulario() {
    setAlterandoSenha(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setErro(null);
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setErro(null);
    setSucesso(null);

    if (newPassword !== confirmPassword) {
      setErro("A confirmação da senha nova não confere.");
      return;
    }

    setSalvando(true);
    try {
      await apiFetch("/api/v1/user/password", {
        method: "PATCH",
        body: {
          current_password: currentPassword,
          password: newPassword,
        },
      });
      fecharFormulario();
      setSucesso("Senha atualizada e outras sessões encerradas.");
    } catch (error) {
      setErro(error.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <PanelCard
      id="conta"
      title="Minha conta"
      subtitle="Operador"
      icon={<UserCircleIcon />}
      tone="muted"
      actions={
        <button
          type="button"
          onClick={() => {
            setSucesso(null);
            setErro(null);
            setAlterandoSenha((v) => !v);
          }}
          className="adm-btn adm-btn-secondary adm-btn-xs"
        >
          {alterandoSenha ? "Cancelar" : "Alterar senha"}
        </button>
      }
    >
      {erro ? (
        <div className="adm-alert adm-alert-error" role="alert">
          {erro}
        </div>
      ) : null}
      {sucesso ? (
        <div className="adm-alert adm-alert-success" role="status">
          {sucesso}
        </div>
      ) : null}

      {alterandoSenha ? (
        <form onSubmit={handlePasswordSubmit}>
          <div className="adm-field">
            <label htmlFor="senha-atual" className="adm-field-label">
              Senha atual
            </label>
            <input
              id="senha-atual"
              name="current_password"
              type="password"
              autoComplete="current-password"
              required
              className="adm-input"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>

          <div className="adm-form-grid">
            <div className="adm-field">
              <label htmlFor="senha-nova" className="adm-field-label">
                Nova senha (8–72)
              </label>
              <input
                id="senha-nova"
                name="new_password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                className="adm-input"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>

            <div className="adm-field">
              <label htmlFor="senha-confirma" className="adm-field-label">
                Repetir senha
              </label>
              <input
                id="senha-confirma"
                name="confirm_password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={72}
                className="adm-input"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={salvando}
            className="adm-btn adm-btn-dark adm-btn-xs"
          >
            {salvando ? "Salvando…" : "Atualizar senha"}
          </button>
        </form>
      ) : (
        <>
          <div className="adm-kv-line">
            <span className="adm-kv-key">Usuário</span>
            <span>{adminUser?.username}</span>
          </div>
          <div className="adm-kv-line">
            <span className="adm-kv-key">E-mail</span>
            <span className="adm-mono">{adminUser?.email}</span>
          </div>
          <div className="adm-kv-line">
            <span className="adm-kv-key">Permissões</span>
            <div className="adm-row" style={{ gap: 6 }}>
              <span className="adm-muted adm-tnum">
                {activeFeatures.length} ativas
              </span>
              <button
                type="button"
                aria-expanded={verPermissoes}
                onClick={() => setVerPermissoes((v) => !v)}
                className="adm-btn adm-btn-secondary adm-btn-xs"
              >
                {verPermissoes ? "Ocultar" : "Ver"}
              </button>
            </div>
          </div>
          {verPermissoes ? (
            <div className="adm-row" style={{ marginTop: 8, gap: 4 }}>
              {activeFeatures.map((feature) => (
                <span key={feature} className="adm-pill adm-pill-neutral">
                  {FEATURE_LABELS[feature]}
                </span>
              ))}
            </div>
          ) : null}
        </>
      )}
    </PanelCard>
  );
}
