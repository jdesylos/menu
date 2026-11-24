import Link from "next/link";
import { useState } from "react";
import AdminLayout from "components/admin/AdminLayout.js";
import ConfirmModal from "components/admin/ConfirmModal.js";
import PanelCard, { OpenIcon } from "components/admin/PanelCard.js";
import {
  apiFetch,
  formatDateTime,
  formatShortDate,
  hasFeature,
} from "lib/adminApi.js";
import { requireAdmin } from "lib/adminAuth.js";
import user from "models/user.js";

function serialize(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function getServerSideProps(context) {
  try {
    return await requireAdmin(context, {
      requiredFeature: "read:user:admin",
      fetchExtra: async () => {
        const detail = await user.findAdminDetailById(context.params?.id);
        return { initialDetail: serialize(detail) };
      },
    });
  } catch (error) {
    if (error.name === "NotFoundError" || error.statusCode === 404) {
      return { notFound: true };
    }
    throw error;
  }
}

export default function AdminUsuarioDetalhe({
  adminUser,
  forbidden,
  forbiddenMessage,
  initialDetail,
}) {
  const [conta, setConta] = useState(initialDetail);
  const [username, setUsername] = useState(initialDetail?.username || "");
  const [newEmail, setNewEmail] = useState("");
  const [emailMode, setEmailMode] = useState("verify");

  const [salvando, setSalvando] = useState(false);
  const [confirmAdmin, setConfirmAdmin] = useState(false);
  const [alterandoAdmin, setAlterandoAdmin] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);

  const canEditUser = hasFeature(adminUser, "update:user:others");
  const canEraseUser = hasFeature(adminUser, "erase:user:others");
  const canManageAdmins = hasFeature(adminUser, "manage:admins");
  const canToggleAdmin = canManageAdmins && canEditUser;
  const isSelf = adminUser?.id === conta?.id;
  const isTargetAdmin = Boolean(conta?.features?.includes("admin"));
  const isTargetPending = Boolean(
    conta?.features?.includes("read:activation_token"),
  );

  async function recarregar() {
    const fresh = await apiFetch(
      `/api/v1/admin/users/${encodeURIComponent(conta.id)}`,
    );
    setConta(fresh);
    setUsername(fresh.username || "");
  }

  async function salvarUsername(event) {
    event.preventDefault();
    setErro(null);
    setSucesso(null);
    setSalvando(true);
    try {
      await apiFetch(`/api/v1/admin/users/${encodeURIComponent(conta.id)}`, {
        method: "PATCH",
        body: { action: "change_username", username },
      });
      await recarregar();
      setSucesso("Nome de usuário atualizado e registrado na auditoria.");
    } catch (error) {
      setErro(error.message);
    } finally {
      setSalvando(false);
    }
  }

  async function salvarEmail(event) {
    event.preventDefault();
    setErro(null);
    setSucesso(null);
    setSalvando(true);
    try {
      const response = await apiFetch(
        `/api/v1/admin/users/${encodeURIComponent(conta.id)}`,
        {
          method: "PATCH",
          body: {
            action: "change_email",
            email: newEmail,
            mode: emailMode,
          },
        },
      );
      setNewEmail("");
      await recarregar();
      setSucesso(
        response.mode === "immediate"
          ? "E-mail atualizado imediatamente e registrado na auditoria."
          : "Link de confirmação enviado ao novo e-mail.",
      );
    } catch (error) {
      setErro(error.message);
    } finally {
      setSalvando(false);
    }
  }

  async function alternarAdmin() {
    if (!conta?.id) return;
    setErro(null);
    setSucesso(null);
    setAlterandoAdmin(true);
    try {
      const action = isTargetAdmin ? "revoke_admin" : "grant_admin";
      await apiFetch(`/api/v1/admin/users/${encodeURIComponent(conta.id)}`, {
        method: "PATCH",
        body: { action },
      });
      setConfirmAdmin(false);
      await recarregar();
      setSucesso(
        isTargetAdmin
          ? "Acesso administrativo removido desta conta."
          : "Conta promovida a administradora com acesso completo.",
      );
    } catch (error) {
      setErro(error.message);
      setConfirmAdmin(false);
    } finally {
      setAlterandoAdmin(false);
    }
  }

  async function excluirUsuario() {
    setErro(null);
    setExcluindo(true);
    try {
      await apiFetch(`/api/v1/admin/users/${encodeURIComponent(conta.id)}`, {
        method: "DELETE",
      });
      setConfirmExcluir(false);
      await recarregar();
      setSucesso("Conta excluída com sucesso e sessões encerradas.");
    } catch (error) {
      setErro(error.message);
      setConfirmExcluir(false);
    } finally {
      setExcluindo(false);
    }
  }

  return (
    <AdminLayout
      titulo={conta?.username || "Conta excluída"}
      subtitulo={`${conta?.id} • ${formatShortDate(conta?.created_at)}`}
      adminUser={adminUser}
      forbidden={forbidden}
      forbiddenMessage={forbiddenMessage}
      acoes={
        <Link
          href="/admin#usuarios"
          className="adm-btn adm-btn-secondary adm-btn-sm"
        >
          Voltar
        </Link>
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

      {conta?.deleted_at ? (
        <div className="adm-alert adm-alert-warn">
          Conta excluída em {formatDateTime(conta.deleted_at)}. Dados pessoais
          removidos, histórico mantido.
        </div>
      ) : null}

      <div className="adm-split">
        <div>
          <PanelCard title="Dados da conta">
            <div className="adm-kv-line">
              <span className="adm-kv-key">Usuário</span>
              <span>{conta?.username || "—"}</span>
            </div>
            <div className="adm-kv-line">
              <span className="adm-kv-key">E-mail atual</span>
              <span>{conta?.email || "—"}</span>
            </div>

            {conta?.pending_email_change ? (
              <div
                className="adm-alert adm-alert-info"
                style={{ marginTop: 8, marginBottom: 0 }}
              >
                Troca pendente para{" "}
                <strong>{conta.pending_email_change.new_email}</strong> até{" "}
                {formatDateTime(conta.pending_email_change.expires_at)}.
              </div>
            ) : null}

            {!conta?.deleted_at && canEditUser ? (
              <form
                onSubmit={salvarUsername}
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid #E3E9ED",
                }}
              >
                <div className="adm-field" style={{ marginBottom: 0 }}>
                  <label htmlFor="edit-username" className="adm-field-label">
                    Alterar nome de usuário
                  </label>
                  <div className="adm-row">
                    <input
                      id="edit-username"
                      type="text"
                      required
                      maxLength={30}
                      className="adm-input"
                      style={{ flex: 1 }}
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                    />
                    <button
                      type="submit"
                      disabled={salvando}
                      className="adm-btn adm-btn-dark adm-btn-sm"
                    >
                      Salvar nome
                    </button>
                  </div>
                </div>
              </form>
            ) : null}

            {!conta?.deleted_at && canEditUser ? (
              <form
                onSubmit={salvarEmail}
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: "1px solid #E3E9ED",
                }}
              >
                <div className="adm-field">
                  <label htmlFor="edit-email" className="adm-field-label">
                    Alterar e-mail
                  </label>
                  <input
                    id="edit-email"
                    type="email"
                    required
                    placeholder="novo@email.com"
                    className="adm-input"
                    value={newEmail}
                    onChange={(event) => setNewEmail(event.target.value)}
                  />
                </div>
                <div className="adm-row">
                  <select
                    id="edit-email-mode"
                    aria-label="Modo de alteração de e-mail"
                    className="adm-select"
                    style={{ flex: 1 }}
                    value={emailMode}
                    onChange={(event) => setEmailMode(event.target.value)}
                  >
                    <option value="verify">
                      Enviar link de confirmação (recomendado)
                    </option>
                    <option value="immediate">
                      Aplicar troca imediata (suporte 1.4)
                    </option>
                  </select>
                  <button
                    type="submit"
                    disabled={salvando}
                    className="adm-btn adm-btn-primary adm-btn-sm"
                  >
                    {emailMode === "immediate" ? "Aplicar" : "Enviar link"}
                  </button>
                </div>
              </form>
            ) : null}
          </PanelCard>

          {!conta?.deleted_at ? (
            <PanelCard title="Acesso administrativo">
              <div
                className="adm-row-between"
                style={{ gap: 10, flexWrap: "wrap" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    className={`adm-pill ${
                      isTargetAdmin
                        ? "adm-pill-blue"
                        : isTargetPending
                          ? "adm-pill-amber"
                          : "adm-pill-green"
                    }`}
                  >
                    {isTargetAdmin
                      ? "Administrador"
                      : isTargetPending
                        ? "Pendente"
                        : "Usuário comum"}
                  </span>
                  <span className="adm-muted">
                    {isTargetAdmin
                      ? "Acesso completo ao painel administrativo."
                      : isTargetPending
                        ? "A conta precisa concluir a ativação por e-mail antes de virar admin."
                        : "Sem acesso ao painel administrativo."}
                  </span>
                </div>

                {canToggleAdmin && !isSelf && !isTargetPending ? (
                  <button
                    type="button"
                    onClick={() => setConfirmAdmin(true)}
                    disabled={alterandoAdmin}
                    className={
                      isTargetAdmin
                        ? "adm-btn adm-btn-secondary adm-btn-sm"
                        : "adm-btn adm-btn-primary adm-btn-sm"
                    }
                  >
                    {isTargetAdmin ? "Remover admin" : "Tornar admin"}
                  </button>
                ) : isSelf && isTargetAdmin ? (
                  <span className="adm-muted">Sua própria conta</span>
                ) : null}
              </div>
            </PanelCard>
          ) : null}

          {!conta?.deleted_at && canEraseUser && !isSelf ? (
            <PanelCard title="Exclusão definitiva">
              <div className="adm-row-between">
                <span className="adm-muted">
                  Remove dados pessoais e sessões, mantendo contribuições.
                </span>
                <button
                  type="button"
                  onClick={() => setConfirmExcluir(true)}
                  className="adm-btn adm-btn-danger adm-btn-sm"
                >
                  Excluir conta
                </button>
              </div>
            </PanelCard>
          ) : null}
        </div>

        <div>
          <PanelCard
            title="Auditoria recente"
            actions={
              <span className="adm-muted adm-tnum">
                {(conta?.audit_logs || []).length} registro(s)
              </span>
            }
          >
            {(conta?.audit_logs || []).length === 0 ? (
              <p className="adm-muted" style={{ margin: 0 }}>
                Nenhum registro de auditoria.
              </p>
            ) : (
              <ul className="adm-list">
                {conta.audit_logs.map((log) => (
                  <li key={log.id} className="adm-list-row">
                    <span aria-hidden="true" className="adm-rail is-blue" />
                    <div className="adm-row-main">
                      <div className="adm-row-title adm-mono">{log.action}</div>
                      <div className="adm-row-sub adm-mono">
                        {JSON.stringify(log.metadata || {})}
                      </div>
                    </div>
                    <div className="adm-row-right">
                      <span className="adm-muted adm-tnum">
                        {formatShortDate(log.created_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>

          <PanelCard
            title="Cardápios enviados"
            actions={
              <span className="adm-muted adm-tnum">
                {(conta?.recent_menus || []).length}
              </span>
            }
          >
            {(conta?.recent_menus || []).length === 0 ? (
              <p className="adm-muted" style={{ margin: 0 }}>
                Nenhum cardápio enviado por esta conta.
              </p>
            ) : (
              <ul className="adm-list">
                {conta.recent_menus.map((item) => (
                  <li key={item.id} className="adm-list-row">
                    <span aria-hidden="true" className="adm-rail is-green" />
                    <div className="adm-row-main">
                      <div className="adm-row-title">
                        <span>{item.place_name}</span>
                        <span className="adm-pill adm-pill-neutral">
                          {item.currency}
                        </span>
                      </div>
                    </div>
                    <div className="adm-row-right">
                      <span className="adm-muted adm-tnum">
                        {formatShortDate(item.created_at)}
                      </span>
                      <Link
                        href={`/admin/estabelecimentos/${item.place_id}#cardapio`}
                        title="Abrir cardápio"
                        aria-label={`Abrir cardápio de ${item.place_name}`}
                        className="adm-btn adm-btn-secondary adm-btn-icon"
                      >
                        <OpenIcon />
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </PanelCard>
        </div>
      </div>

      <ConfirmModal
        aberto={confirmAdmin}
        titulo={
          isTargetAdmin ? "Remover administrador" : "Tornar administrador"
        }
        mensagem={
          isTargetAdmin
            ? `Confirma remover o acesso administrativo da conta "${conta?.username || conta?.email}"?`
            : `Confirma conceder acesso total ao painel administrativo para "${conta?.username || conta?.email}"?`
        }
        textoConfirmar={isTargetAdmin ? "Remover admin" : "Tornar admin"}
        perigoso={isTargetAdmin}
        carregando={alterandoAdmin}
        onConfirmar={alternarAdmin}
        onCancelar={() => setConfirmAdmin(false)}
      />

      <ConfirmModal
        aberto={confirmExcluir}
        titulo="Excluir conta de usuário"
        mensagem={`Confirma a exclusão permanente da conta "${conta?.username}" (${conta?.email})?`}
        textoConfirmar="Confirmar exclusão"
        exigirTexto={conta?.username}
        carregando={excluindo}
        onConfirmar={excluirUsuario}
        onCancelar={() => setConfirmExcluir(false)}
      />
    </AdminLayout>
  );
}
