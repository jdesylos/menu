import Link from "next/link";
import { useRouter } from "next/router";
import { useState } from "react";
import AdminLayout from "components/admin/AdminLayout.js";
import ConfirmModal from "components/admin/ConfirmModal.js";
import EditorCardapio from "components/admin/EditorCardapio.js";
import PanelCard from "components/admin/PanelCard.js";
import PlaceForm from "components/admin/PlaceForm.js";
import database from "infra/database.js";
import { NotFoundError } from "infra/errors.js";
import {
  apiFetch,
  formatDateTime,
  formatShortDate,
  hasFeature,
} from "lib/adminApi.js";
import { requireAdmin } from "lib/adminAuth.js";
import menuAdmin from "models/menuAdmin.js";

function serialize(value) {
  return JSON.parse(JSON.stringify(value));
}

export async function getServerSideProps(context) {
  try {
    return await requireAdmin(context, {
      requiredFeature: "manage:place",
      fetchExtra: async () => {
        const placeId = context.params?.id;
        const {
          place: found,
          latest_menu,
          history,
        } = await menuAdmin.findPlaceMenus(placeId);

        const sugResult = await database.query({
          text: `
            SELECT id, kind, status, changes, created_at
            FROM place_suggestions
            WHERE place_id = $1 OR duplicate_of = $1
            ORDER BY created_at DESC
            LIMIT 10
          ;`,
          values: [found.id],
        });

        const refSuggestion = sugResult.rows.find(
          (row) =>
            row.changes &&
            Number.isFinite(Number(row.changes.latitude)) &&
            Number.isFinite(Number(row.changes.longitude)),
        );

        return {
          initialPlace: serialize(found),
          initialMenu: serialize(latest_menu),
          initialHistory: serialize(history),
          referencia: refSuggestion
            ? {
                latitude: Number(refSuggestion.changes.latitude),
                longitude: Number(refSuggestion.changes.longitude),
                label: "Coordenada da sugestão de usuário",
              }
            : null,
        };
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return { notFound: true };
    }
    throw error;
  }
}

export default function AdminEstabelecimentoDetalhe({
  adminUser,
  forbidden,
  forbiddenMessage,
  initialPlace,
  initialMenu,
  initialHistory,
  referencia,
}) {
  const router = useRouter();
  const [local, setLocal] = useState(initialPlace);
  const [historico, setHistorico] = useState(initialHistory || []);
  const [salvandoLocal, setSalvandoLocal] = useState(false);
  const [reason, setReason] = useState("admin_removed");
  const [duplicateOf, setDuplicateOf] = useState("");
  const [processandoStatus, setProcessandoStatus] = useState(false);
  const [confirmExcluir, setConfirmExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);

  const canManageMenu = hasFeature(adminUser, "manage:menu");
  const canPhysicalDelete =
    local?.source === "admin" && historico.length === 0 && !local.duplicate_of;

  async function salvarLocal(payload) {
    setErro(null);
    setSucesso(null);
    setSalvandoLocal(true);
    try {
      const updated = await apiFetch(
        `/api/v1/admin/places/${encodeURIComponent(local.id)}`,
        { method: "PATCH", body: payload },
      );
      setLocal(updated);
      setSucesso("Dados do estabelecimento atualizados.");
    } catch (error) {
      setErro(error.message);
    } finally {
      setSalvandoLocal(false);
    }
  }

  async function ocultarLocal() {
    setErro(null);
    setSucesso(null);
    setProcessandoStatus(true);
    try {
      const updated = await apiFetch(
        `/api/v1/admin/places/${encodeURIComponent(local.id)}`,
        {
          method: "PATCH",
          body: {
            action: "hide",
            reason,
            duplicate_of: duplicateOf.trim() || null,
          },
        },
      );
      setLocal(updated);
      setSucesso("Estabelecimento excluído do mapa.");
    } catch (error) {
      setErro(error.message);
    } finally {
      setProcessandoStatus(false);
    }
  }

  async function restaurarLocal() {
    setErro(null);
    setSucesso(null);
    setProcessandoStatus(true);
    try {
      const updated = await apiFetch(
        `/api/v1/admin/places/${encodeURIComponent(local.id)}`,
        { method: "PATCH", body: { action: "restore" } },
      );
      setLocal(updated);
      setSucesso("Estabelecimento restaurado no mapa.");
    } catch (error) {
      setErro(error.message);
    } finally {
      setProcessandoStatus(false);
    }
  }

  async function excluirDefinitivo() {
    setErro(null);
    setExcluindo(true);
    try {
      await apiFetch(`/api/v1/admin/places/${encodeURIComponent(local.id)}`, {
        method: "DELETE",
      });
      router.push("/admin");
    } catch (error) {
      setErro(error.message);
      setExcluindo(false);
      setConfirmExcluir(false);
    }
  }

  async function atualizarHistorico() {
    try {
      const refreshed = await apiFetch(
        `/api/v1/admin/menus/${encodeURIComponent(local.id)}`,
      );
      setHistorico(refreshed.history || []);
    } catch {
      // Silencioso: o cardápio já foi salvo.
    }
  }

  return (
    <AdminLayout
      titulo={local?.name || "Estabelecimento"}
      subtitulo={`${local?.source} • ${local?.id}`}
      adminUser={adminUser}
      forbidden={forbidden}
      forbiddenMessage={forbiddenMessage}
      acoes={
        <>
          <Link href="/admin" className="adm-btn adm-btn-secondary adm-btn-sm">
            Voltar
          </Link>
          <a
            href={`/cardapio/${local?.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="adm-btn adm-btn-secondary adm-btn-sm"
          >
            Link público
          </a>
        </>
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

      <PanelCard
        title="Situação no mapa"
        actions={
          local?.hidden_at ? (
            <span className="adm-pill adm-pill-amber">
              Excluído ({local.hidden_reason}) •{" "}
              {formatDateTime(local.hidden_at)}
            </span>
          ) : (
            <span className="adm-pill adm-pill-green">Visível no app</span>
          )
        }
      >
        <div className="adm-row-between">
          {local?.hidden_at ? (
            <button
              type="button"
              disabled={processandoStatus}
              onClick={restaurarLocal}
              className="adm-btn adm-btn-primary adm-btn-sm"
            >
              {processandoStatus ? "Restaurando..." : "Restaurar no mapa"}
            </button>
          ) : (
            <div className="adm-row">
              <select
                aria-label="Motivo da exclusão"
                className="adm-select adm-select-inline"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              >
                <option value="admin_removed">Excluído pela equipe</option>
                <option value="reported_closed">Estabelecimento fechou</option>
                <option value="reported_duplicate">Duplicata de outro</option>
              </select>
              {reason === "reported_duplicate" ? (
                <input
                  type="text"
                  placeholder="UUID do local principal"
                  className="adm-input adm-mono"
                  style={{ width: 240 }}
                  value={duplicateOf}
                  onChange={(event) => setDuplicateOf(event.target.value)}
                />
              ) : null}
              <button
                type="button"
                disabled={processandoStatus}
                onClick={ocultarLocal}
                className="adm-btn adm-btn-danger adm-btn-sm"
              >
                {processandoStatus ? "Excluindo…" : "Excluir do mapa"}
              </button>
            </div>
          )}

          {canPhysicalDelete ? (
            <button
              type="button"
              onClick={() => setConfirmExcluir(true)}
              className="adm-btn adm-btn-danger adm-btn-sm"
            >
              Apagar permanentemente
            </button>
          ) : null}
        </div>
      </PanelCard>

      <PanelCard title="Dados cadastrais e coordenadas">
        <PlaceForm
          initialValues={local}
          referencia={referencia}
          submitLabel="Salvar alterações"
          salvando={salvandoLocal}
          onSubmit={salvarLocal}
        />
      </PanelCard>

      {canManageMenu ? (
        <PanelCard
          id="cardapio"
          title="Cardápio"
          actions={
            historico.length > 0 ? (
              <span className="adm-muted adm-tnum">
                {historico.length} revisão(ões)
              </span>
            ) : null
          }
        >
          <EditorCardapio
            placeId={local.id}
            initialMenu={initialMenu}
            onSaved={atualizarHistorico}
          />

          {historico.length > 0 ? (
            <div
              style={{
                marginTop: 14,
                paddingTop: 10,
                borderTop: "1px solid #E3E9ED",
              }}
            >
              <h3 className="adm-card-title">Histórico de revisões</h3>
              <ul className="adm-list">
                {historico.map((rev) => (
                  <li key={rev.id} className="adm-list-row">
                    <span aria-hidden="true" className="adm-rail is-blue" />
                    <div className="adm-row-main">
                      <div className="adm-row-title">
                        <span>{rev.author_username || "Conta removida"}</span>
                        <span className="adm-pill adm-pill-neutral">
                          {rev.currency}
                        </span>
                        <span className="adm-pill adm-pill-blue adm-tnum">
                          {rev.items_count} pratos
                        </span>
                      </div>
                    </div>
                    <div className="adm-row-right">
                      <span className="adm-muted adm-tnum">
                        {formatShortDate(rev.created_at)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </PanelCard>
      ) : null}

      <ConfirmModal
        aberto={confirmExcluir}
        titulo="Apagar estabelecimento"
        mensagem={`Remove "${local?.name}" de forma permanente do banco (apenas locais admin sem histórico).`}
        textoConfirmar="Apagar definitivamente"
        exigirTexto={local?.name}
        carregando={excluindo}
        onConfirmar={excluirDefinitivo}
        onCancelar={() => setConfirmExcluir(false)}
      />
    </AdminLayout>
  );
}
