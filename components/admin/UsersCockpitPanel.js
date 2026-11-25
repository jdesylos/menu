import Link from "next/link";
import { useMemo, useState } from "react";
import ConfirmModal from "components/admin/ConfirmModal.js";
import PanelCard, {
  CrownIcon,
  CrownOffIcon,
  OpenIcon,
  PaginationBar,
  SearchIcon,
  UsersIcon,
} from "components/admin/PanelCard.js";
import { apiFetch, formatShortDate, hasFeature } from "lib/adminApi.js";

const EMPTY_ITEMS = [];

function accountStatus(item) {
  if (item.deleted_at) {
    return {
      key: "deleted",
      label: "Excluída",
      pill: "adm-pill-red",
      rail: "is-red",
    };
  }
  if (item.features?.includes("admin")) {
    return {
      key: "admin",
      label: "Admin",
      pill: "adm-pill-blue",
      rail: "is-blue",
    };
  }
  if (item.features?.includes("read:activation_token")) {
    return {
      key: "pending",
      label: "Pendente",
      pill: "adm-pill-amber",
      rail: "is-amber",
    };
  }
  return { key: "active", label: "Ativa", pill: "adm-pill-green", rail: "" };
}

export default function UsersCockpitPanel({
  adminUser,
  initialUsers,
  initialQuery,
  accountStats = null,
  onAdminRoleChanged = null,
}) {
  const [q, setQ] = useState(initialQuery?.users_q || "");
  const [filter, setFilter] = useState(initialQuery?.users_filter || "all");
  const [resultado, setResultado] = useState(initialUsers);
  const [buscando, setBuscando] = useState(false);

  const [adminTarget, setAdminTarget] = useState(null);
  const [alterandoAdmin, setAlterandoAdmin] = useState(false);

  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);

  const canToggleAdmin =
    hasFeature(adminUser, "manage:admins") &&
    hasFeature(adminUser, "update:user:others");
  const items = resultado?.items ?? EMPTY_ITEMS;

  const counts = useMemo(() => {
    if (accountStats && filter === "all" && !q.trim()) {
      const active = Math.max(
        0,
        (accountStats.active ?? 0) -
          (accountStats.admin ?? 0) -
          (accountStats.pending ?? 0),
      );
      return {
        admin: accountStats.admin ?? 0,
        active,
        pending: accountStats.pending ?? 0,
        deleted: 0,
        total: accountStats.active ?? 0,
      };
    }

    let admin = 0;
    let active = 0;
    let pending = 0;
    let deleted = 0;
    for (const item of items) {
      const status = accountStatus(item);
      if (status.key === "admin") admin += 1;
      else if (status.key === "active") active += 1;
      else if (status.key === "pending") pending += 1;
      else deleted += 1;
    }
    return { admin, active, pending, deleted, total: items.length };
  }, [accountStats, filter, items, q]);

  async function buscar({ nextPage = 1, nextFilter = filter, nextQ = q } = {}) {
    setErro(null);
    setBuscando(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: "12",
        filter: nextFilter,
      });
      if (nextQ.trim()) params.set("q", nextQ.trim());
      const data = await apiFetch(`/api/v1/admin/users?${params.toString()}`);
      setResultado(data);
    } catch (error) {
      setErro(error.message);
    } finally {
      setBuscando(false);
    }
  }

  async function confirmarAlteracaoAdmin() {
    if (!adminTarget) return;
    const wasAdmin = adminTarget.isAdmin;
    const label = adminTarget.username || adminTarget.email || adminTarget.id;

    setErro(null);
    setSucesso(null);
    setAlterandoAdmin(true);
    try {
      await apiFetch(
        `/api/v1/admin/users/${encodeURIComponent(adminTarget.id)}`,
        {
          method: "PATCH",
          body: { action: wasAdmin ? "revoke_admin" : "grant_admin" },
        },
      );
      setAdminTarget(null);
      await buscar({ nextPage: resultado?.page || 1 });
      onAdminRoleChanged?.(wasAdmin ? -1 : 1);
      setSucesso(
        wasAdmin
          ? `Acesso administrativo removido de ${label}.`
          : `${label} agora é administrador.`,
      );
    } catch (error) {
      setErro(error.message);
      setAdminTarget(null);
    } finally {
      setAlterandoAdmin(false);
    }
  }

  const totalPages = Math.max(
    1,
    Math.ceil((resultado?.total || 0) / (resultado?.limit || 12)),
  );

  return (
    <>
      <PanelCard
        id="usuarios"
        title="Usuários"
        subtitle="Diretório"
        icon={<UsersIcon />}
        tone="directory"
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

        {counts.total > 0 ? (
          <div style={{ marginBottom: 8 }}>
            <div className="adm-funnel-bar" aria-hidden="true">
              {counts.admin > 0 ? (
                <div
                  className="adm-funnel-seg is-blue"
                  style={{ width: `${(counts.admin / counts.total) * 100}%` }}
                />
              ) : null}
              {counts.active > 0 ? (
                <div
                  className="adm-funnel-seg is-green"
                  style={{ width: `${(counts.active / counts.total) * 100}%` }}
                />
              ) : null}
              {counts.pending > 0 ? (
                <div
                  className="adm-funnel-seg is-amber"
                  style={{ width: `${(counts.pending / counts.total) * 100}%` }}
                />
              ) : null}
              {counts.deleted > 0 ? (
                <div
                  className="adm-funnel-seg is-neutral"
                  style={{ width: `${(counts.deleted / counts.total) * 100}%` }}
                />
              ) : null}
            </div>
            <div className="adm-legend-row">
              {counts.admin > 0 ? (
                <span className="adm-legend-item">
                  <span className="adm-dot is-blue" />
                  <strong className="adm-tnum">{counts.admin}</strong>
                  <span className="adm-muted">ADMINS</span>
                </span>
              ) : null}
              <span className="adm-legend-item">
                <span className="adm-dot is-green" />
                <strong className="adm-tnum">{counts.active}</strong>
                <span className="adm-muted">ATIVAS</span>
              </span>
              <span className="adm-legend-item">
                <span className="adm-dot is-amber" />
                <strong className="adm-tnum">{counts.pending}</strong>
                <span className="adm-muted">PENDENTES</span>
              </span>
              {counts.deleted > 0 ? (
                <span className="adm-legend-item">
                  <span className="adm-dot is-neutral" />
                  <strong className="adm-tnum">{counts.deleted}</strong>
                  <span className="adm-muted">EXCLUÍDAS</span>
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            buscar({ nextPage: 1 });
          }}
          className="adm-toolbar"
        >
          <label className="adm-search-box">
            <SearchIcon />
            <input
              id="busca-usuario"
              name="user_search"
              type="text"
              autoComplete="off"
              spellCheck={false}
              placeholder="Usuário, e-mail ou UUID…"
              aria-label="Usuário, e-mail ou UUID"
              className="adm-search-input"
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
          </label>

          <select
            id="filtro-usuario"
            aria-label="Situação da conta"
            className="adm-select adm-select-inline"
            value={filter}
            onChange={(event) => {
              const next = event.target.value;
              setFilter(next);
              buscar({ nextPage: 1, nextFilter: next });
            }}
          >
            <option value="all">Todas</option>
            <option value="active">Ativas</option>
            <option value="pending">Pendentes</option>
            <option value="admin">Admins</option>
            <option value="deleted">Excluídas</option>
          </select>

          <button
            type="submit"
            disabled={buscando}
            className="adm-btn adm-btn-dark adm-btn-sm"
          >
            {buscando ? "Buscando…" : "Buscar"}
          </button>
        </form>

        {items.length === 0 ? (
          <p
            className="adm-muted"
            style={{ margin: "10px 0", textAlign: "center" }}
          >
            Nenhuma conta encontrada.
          </p>
        ) : (
          <ul className="adm-list adm-list-compact">
            {items.map((item) => {
              const status = accountStatus(item);
              const isTargetAdmin = status.key === "admin";
              const canAlterAdmin =
                canToggleAdmin &&
                status.key !== "pending" &&
                status.key !== "deleted" &&
                item.id !== adminUser?.id;

              return (
                <li key={item.id} className="adm-list-row">
                  <span
                    aria-hidden="true"
                    className={`adm-rail ${status.rail}`}
                  />

                  <div className="adm-row-main">
                    <div className="adm-row-title">
                      <span>{item.username || "(conta excluída)"}</span>
                      <span className={`adm-pill ${status.pill}`}>
                        {status.label}
                      </span>
                    </div>
                    <div className="adm-row-sub" title={item.email || item.id}>
                      {item.email || item.id} •{" "}
                      <span className="adm-tnum">
                        {item.menus_count} card. • {item.suggestions_count} sug.
                        • {formatShortDate(item.created_at)}
                      </span>
                    </div>
                  </div>

                  <div className="adm-row-right">
                    {canAlterAdmin ? (
                      <button
                        type="button"
                        title={isTargetAdmin ? "Remover admin" : "Tornar admin"}
                        aria-label={
                          isTargetAdmin
                            ? `Remover admin de ${item.username || item.email || "usuário"}`
                            : `Tornar ${item.username || item.email || "usuário"} administrador`
                        }
                        onClick={() =>
                          setAdminTarget({
                            id: item.id,
                            username: item.username,
                            email: item.email,
                            isAdmin: isTargetAdmin,
                          })
                        }
                        className={
                          isTargetAdmin
                            ? "adm-btn adm-btn-secondary adm-btn-icon"
                            : "adm-btn adm-btn-primary adm-btn-icon"
                        }
                      >
                        {isTargetAdmin ? <CrownOffIcon /> : <CrownIcon />}
                      </button>
                    ) : null}
                    <Link
                      href={`/admin/usuarios/${item.id}`}
                      title="Abrir"
                      aria-label={`Abrir detalhes de ${item.username || item.email || "usuário"}`}
                      className="adm-btn adm-btn-secondary adm-btn-icon"
                    >
                      <OpenIcon />
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <PaginationBar
          page={resultado?.page || 1}
          totalPages={totalPages}
          busy={buscando}
          onPageChange={(nextPage) => buscar({ nextPage })}
        />
      </PanelCard>

      <ConfirmModal
        aberto={Boolean(adminTarget)}
        titulo={
          adminTarget?.isAdmin
            ? "Remover administrador"
            : "Tornar administrador"
        }
        mensagem={
          adminTarget?.isAdmin
            ? `Confirma remover o acesso administrativo da conta "${adminTarget?.username || adminTarget?.email}"?`
            : `Confirma conceder acesso total ao painel administrativo para "${adminTarget?.username || adminTarget?.email}"?`
        }
        textoConfirmar={adminTarget?.isAdmin ? "Remover admin" : "Tornar admin"}
        perigoso={Boolean(adminTarget?.isAdmin)}
        carregando={alterandoAdmin}
        onConfirmar={confirmarAlteracaoAdmin}
        onCancelar={() => setAdminTarget(null)}
      />
    </>
  );
}
