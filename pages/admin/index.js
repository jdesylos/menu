import { useState } from "react";
import AccountCockpitPanel from "components/admin/AccountCockpitPanel.js";
import AdminLayout from "components/admin/AdminLayout.js";
import PanelCard, { HistoryIcon } from "components/admin/PanelCard.js";
import PlacesCockpitPanel from "components/admin/PlacesCockpitPanel.js";
import SuggestionsCockpitPanel from "components/admin/SuggestionsCockpitPanel.js";
import SupportCockpitPanel from "components/admin/SupportCockpitPanel.js";
import UsersCockpitPanel from "components/admin/UsersCockpitPanel.js";
import database from "infra/database.js";
import { formatShortDate, hasFeature } from "lib/adminApi.js";
import { requireAdmin } from "lib/adminAuth.js";
import authorization from "models/authorization.js";
import place from "models/place.js";
import placeSuggestion from "models/placeSuggestion.js";
import supportRequest from "models/supportRequest.js";
import user from "models/user.js";

function serialize(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function getServerSideProps(context) {
  return await requireAdmin(context, {
    fetchExtra: async (adminUser) => {
      const q = typeof context.query.q === "string" ? context.query.q : "";
      const visibility =
        typeof context.query.visibility === "string"
          ? context.query.visibility
          : "all";
      const hasMenu =
        typeof context.query.has_menu === "string"
          ? context.query.has_menu
          : "all";
      const usersQ =
        typeof context.query.users_q === "string" ? context.query.users_q : "";
      const usersFilter =
        typeof context.query.users_filter === "string"
          ? context.query.users_filter
          : "all";

      const canManagePlace = hasFeature(adminUser, "manage:place");
      const canManageSupport = hasFeature(adminUser, "manage:support");
      const canReadUsers = hasFeature(adminUser, "read:user:admin");

      const [
        summaryRes,
        auditRes,
        initialPlaces,
        initialSuggestions,
        initialSupportRaw,
        initialUsers,
      ] = await Promise.all([
        database.query(`
          SELECT
            (SELECT count(DISTINCT place_id)::int FROM menus) AS places_with_menus,
            (SELECT count(*)::int FROM places WHERE hidden_at IS NOT NULL) AS hidden_places,
            (SELECT count(*)::int FROM place_suggestions WHERE status = 'pending') AS pending_suggestions,
            (SELECT count(*)::int FROM support_requests WHERE status IN ('open', 'in_progress')) AS open_support_requests,
            (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) AS active_users,
            (SELECT count(*)::int FROM users WHERE deleted_at IS NULL AND 'read:activation_token' = ANY(features)) AS pending_users,
            (SELECT count(*)::int FROM users WHERE deleted_at IS NULL AND 'admin' = ANY(features)) AS admin_users
        ;`),
        database.query(`
          SELECT
            a.id,
            a.action,
            a.created_at,
            u.username AS actor_username
          FROM audit_logs a
          LEFT JOIN users u ON u.id = a.actor_user_id
          ORDER BY a.created_at DESC
          LIMIT 6
        ;`),
        canManagePlace
          ? place.searchForAdmin({
              q,
              visibility,
              has_menu: hasMenu,
              page: 1,
              limit: 12,
            })
          : null,
        canManagePlace
          ? placeSuggestion.findAll(adminUser, { status: "pending" })
          : [],
        canManageSupport
          ? supportRequest.listForAdmin({
              category: "all",
              status: "all",
              page: 1,
              limit: 12,
            })
          : null,
        canReadUsers
          ? user.listForAdmin({
              q: usersQ,
              filter: usersFilter,
              page: 1,
              limit: 12,
            })
          : null,
      ]);

      const initialSupportRequests = initialSupportRaw
        ? {
            ...initialSupportRaw,
            items: initialSupportRaw.items.map((item) =>
              authorization.filterOutput(
                adminUser,
                "read:support_request",
                item,
              ),
            ),
          }
        : null;

      return {
        resumo: serialize(summaryRes.rows[0]),
        recentAudit: serialize(auditRes.rows),
        initialPlaceQuery: { q, visibility, has_menu: hasMenu },
        initialPlaces: serialize(initialPlaces),
        initialSuggestions: serialize(initialSuggestions),
        initialSupportRequests: serialize(initialSupportRequests),
        initialUserQuery: { users_q: usersQ, users_filter: usersFilter },
        initialUsers: serialize(initialUsers),
      };
    },
  });
}

function jumpTo(id) {
  if (typeof document === "undefined") return;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
}

export default function AdminCockpit({
  adminUser,
  forbidden,
  forbiddenMessage,
  resumo,
  recentAudit,
  initialPlaceQuery,
  initialPlaces,
  initialSuggestions,
  initialSupportRequests,
  initialUserQuery,
  initialUsers,
}) {
  const [filterCommand, setFilterCommand] = useState(null);
  const [placePrefillCommand, setPlacePrefillCommand] = useState(null);
  const [supportRefreshSeq, setSupportRefreshSeq] = useState(0);
  const [activePlaceFilter, setActivePlaceFilter] = useState({
    visibility: initialPlaceQuery?.visibility || "all",
    hasMenu: initialPlaceQuery?.has_menu || "all",
  });
  const [pendingSuggestionsCount, setPendingSuggestionsCount] = useState(
    resumo?.pending_suggestions ?? 0,
  );
  const [openSupportCount, setOpenSupportCount] = useState(
    resumo?.open_support_requests ?? 0,
  );
  const [adminUsersCount, setAdminUsersCount] = useState(
    resumo?.admin_users ?? 0,
  );

  const canManagePlace = hasFeature(adminUser, "manage:place");
  const canManageSupport = hasFeature(adminUser, "manage:support");
  const canReadUsers = hasFeature(adminUser, "read:user:admin");

  function handleCreatePlaceFromSupport(item) {
    setPlacePrefillCommand((prev) => ({
      seq: (prev?.seq || 0) + 1,
      requestId: item.id,
      name: item.place_name || "",
      approximateAddress: item.approximate_address || "",
      message: item.message || "",
      latitude: item.latitude ?? null,
      longitude: item.longitude ?? null,
    }));
    jumpTo("locais");
  }

  const isMenuFilterActive =
    activePlaceFilter.hasMenu === "true" &&
    activePlaceFilter.visibility === "all";
  const isHiddenFilterActive =
    activePlaceFilter.visibility === "hidden" &&
    activePlaceFilter.hasMenu === "all";

  function aplicarFiltroLocais({ visibility = "all", hasMenu = "all" }) {
    setActivePlaceFilter({ visibility, hasMenu });
    setFilterCommand((prev) => ({
      seq: (prev?.seq || 0) + 1,
      visibility,
      hasMenu,
    }));
    jumpTo("locais");
  }

  return (
    <AdminLayout
      titulo="Painel administrativo"
      showPageHeader={false}
      adminUser={adminUser}
      forbidden={forbidden}
      forbiddenMessage={forbiddenMessage}
    >
      <div className="adm-kpi-strip">
        <button
          type="button"
          aria-pressed={isMenuFilterActive}
          className={`adm-kpi-item is-blue ${isMenuFilterActive ? "is-active" : ""}`}
          disabled={!canManagePlace}
          onClick={() =>
            aplicarFiltroLocais(
              isMenuFilterActive
                ? { visibility: "all", hasMenu: "all" }
                : { visibility: "all", hasMenu: "true" },
            )
          }
        >
          <div>
            <span className="adm-kpi-label">Com cardápio</span>
            <span className="adm-kpi-value">
              {resumo?.places_with_menus ?? 0}
            </span>
          </div>
          <span className="adm-kpi-sub">
            {isMenuFilterActive ? "Ativo ✓" : "Filtrar →"}
          </span>
        </button>

        <button
          type="button"
          className="adm-kpi-item is-amber"
          disabled={!canManagePlace}
          onClick={() => jumpTo("sugestoes")}
        >
          <div>
            <span className="adm-kpi-label">Sugestões</span>
            <span className="adm-kpi-value">{pendingSuggestionsCount}</span>
          </div>
          <span className="adm-kpi-sub">
            {pendingSuggestionsCount > 0 ? "Revisar →" : "Fila →"}
          </span>
        </button>

        <button
          type="button"
          className="adm-kpi-item is-amber"
          disabled={!canManageSupport}
          onClick={() => jumpTo("solicitacoes")}
        >
          <div>
            <span className="adm-kpi-label">Solicitações</span>
            <span className="adm-kpi-value">{openSupportCount}</span>
          </div>
          <span className="adm-kpi-sub">
            {openSupportCount > 0 ? "Atender →" : "Fila →"}
          </span>
        </button>

        <button
          type="button"
          aria-pressed={isHiddenFilterActive}
          className={`adm-kpi-item is-muted ${isHiddenFilterActive ? "is-active" : ""}`}
          disabled={!canManagePlace}
          onClick={() =>
            aplicarFiltroLocais(
              isHiddenFilterActive
                ? { visibility: "all", hasMenu: "all" }
                : { visibility: "hidden", hasMenu: "all" },
            )
          }
        >
          <div>
            {/* A API usa hidden_at internamente para preservar histórico; no painel exibimos como excluídos. */}
            <span className="adm-kpi-label">Locais excluídos</span>
            <span className="adm-kpi-value">{resumo?.hidden_places ?? 0}</span>
          </div>
          <span className="adm-kpi-sub">
            {isHiddenFilterActive ? "Ativo ✓" : "Filtrar →"}
          </span>
        </button>

        <button
          type="button"
          className="adm-kpi-item is-green"
          disabled={!canReadUsers}
          onClick={() => jumpTo("usuarios")}
        >
          <div>
            <span className="adm-kpi-label">Contas ativas</span>
            <span className="adm-kpi-value">{resumo?.active_users ?? 0}</span>
          </div>
          <span className="adm-kpi-sub adm-tnum">
            {adminUsersCount} admin(s)
          </span>
        </button>
      </div>

      <div className="adm-dash-cols">
        <div className="adm-col-stack adm-col-left">
          <AccountCockpitPanel adminUser={adminUser} />

          <PanelCard
            title="Auditoria recente"
            subtitle="Registros"
            icon={<HistoryIcon />}
            tone="muted"
          >
            {(recentAudit || []).length === 0 ? (
              <p className="adm-muted" style={{ margin: 0 }}>
                Nenhum evento registrado recentemente.
              </p>
            ) : (
              <ul className="adm-list adm-list-compact">
                {recentAudit.map((log) => (
                  <li key={log.id} className="adm-list-row">
                    <span
                      aria-hidden="true"
                      className={`adm-rail ${log.action?.startsWith("admin.") ? "is-blue" : ""}`}
                    />
                    <div className="adm-row-main">
                      <div className="adm-row-title adm-mono">{log.action}</div>
                      <div className="adm-row-sub">
                        {log.actor_username || "sistema"}
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
        </div>

        <div className="adm-col-stack adm-col-center">
          {canManagePlace ? (
            <>
              <PlacesCockpitPanel
                initialQuery={initialPlaceQuery}
                initialPlaces={initialPlaces}
                filterCommand={filterCommand}
                onFilterStateChange={setActivePlaceFilter}
                prefillCommand={placePrefillCommand}
                onSupportLinked={() => setSupportRefreshSeq((prev) => prev + 1)}
              />
              <SuggestionsCockpitPanel
                initialSuggestions={initialSuggestions}
                onPendingCountChange={setPendingSuggestionsCount}
              />
            </>
          ) : null}
          {canManageSupport ? (
            <SupportCockpitPanel
              initialRequests={initialSupportRequests}
              canManagePlace={canManagePlace}
              onOpenCountChange={setOpenSupportCount}
              onCreatePlaceFromSupport={handleCreatePlaceFromSupport}
              refreshSignal={supportRefreshSeq}
            />
          ) : null}
        </div>

        <div className="adm-col-stack adm-col-right">
          {canReadUsers ? (
            <UsersCockpitPanel
              adminUser={adminUser}
              initialUsers={initialUsers}
              initialQuery={initialUserQuery}
              accountStats={{
                active: resumo?.active_users ?? 0,
                admin: adminUsersCount,
                pending: resumo?.pending_users ?? 0,
              }}
              onAdminRoleChanged={(delta) =>
                setAdminUsersCount((prev) => Math.max(0, prev + delta))
              }
            />
          ) : null}
        </div>
      </div>
    </AdminLayout>
  );
}
