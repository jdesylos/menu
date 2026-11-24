import Link from "next/link";
import { useState } from "react";
import PanelCard, { InboxIcon } from "components/admin/PanelCard.js";
import { apiFetch, formatShortDate } from "lib/adminApi.js";

const KIND_LABELS = {
  create: "Novo local",
  update: "Correção",
  close: "Fechou",
  duplicate: "Duplicata",
};

function summarizeSuggestion(changes) {
  if (!changes || typeof changes !== "object") return "—";
  const parts = [
    changes.name,
    changes.street,
    changes.neighborhood,
    changes.locality,
    changes.reason,
  ].filter(Boolean);
  if (parts.length > 0) return parts.join(" • ");
  return JSON.stringify(changes);
}

export default function SuggestionsCockpitPanel({
  initialSuggestions,
  onPendingCountChange,
}) {
  const [statusFilter, setStatusFilter] = useState("pending");
  const [sugestoes, setSugestoes] = useState(initialSuggestions || []);
  const [carregando, setCarregando] = useState(false);
  const [revisandoId, setRevisandoId] = useState(null);
  const [erro, setErro] = useState(null);

  async function carregar(nextStatus = statusFilter) {
    setErro(null);
    setCarregando(true);
    try {
      const data = await apiFetch(
        `/api/v1/suggestions?status=${encodeURIComponent(nextStatus)}`,
      );
      const list = data.suggestions || [];
      setSugestoes(list);
      if (nextStatus === "pending") {
        onPendingCountChange?.(list.length);
      }
    } catch (error) {
      setErro(error.message);
    } finally {
      setCarregando(false);
    }
  }

  async function revisar(id, status) {
    setErro(null);
    setRevisandoId(id);
    try {
      await apiFetch(`/api/v1/suggestions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { status },
      });
      await carregar(statusFilter);
    } catch (error) {
      setErro(error.message);
    } finally {
      setRevisandoId(null);
    }
  }

  return (
    <PanelCard
      id="sugestoes"
      title="Sugestões de usuários"
      subtitle="Moderação"
      icon={<InboxIcon />}
      tone="attention"
      actions={
        <>
          {statusFilter === "pending" && sugestoes.length > 0 ? (
            <span className="adm-pill adm-pill-amber adm-tnum">
              {sugestoes.length} na fila
            </span>
          ) : null}
          <select
            id="sug-status"
            aria-label="Situação das sugestões"
            className="adm-select adm-select-inline"
            value={statusFilter}
            onChange={(event) => {
              const next = event.target.value;
              setStatusFilter(next);
              carregar(next);
            }}
          >
            <option value="pending">Pendentes</option>
            <option value="accepted">Aceitas</option>
            <option value="rejected">Recusadas</option>
          </select>
          <button
            type="button"
            onClick={() => carregar(statusFilter)}
            disabled={carregando}
            className="adm-btn adm-btn-secondary adm-btn-xs"
          >
            {carregando ? "Atualizando…" : "Atualizar"}
          </button>
        </>
      }
    >
      {erro ? (
        <div className="adm-alert adm-alert-error" role="alert">
          {erro}
        </div>
      ) : null}

      {sugestoes.length === 0 ? (
        <p
          className="adm-muted"
          style={{ margin: "10px 0", textAlign: "center" }}
        >
          Nenhuma sugestão nesta situação.
        </p>
      ) : (
        <ul className="adm-list adm-list-compact">
          {sugestoes.map((sug) => {
            const railClass =
              sug.status === "accepted"
                ? "is-green"
                : sug.status === "rejected"
                  ? "is-red"
                  : "is-amber";

            return (
              <li key={sug.id} className="adm-list-row">
                <span aria-hidden="true" className={`adm-rail ${railClass}`} />

                <div className="adm-row-main">
                  <div className="adm-row-title">
                    <span className="adm-pill adm-pill-amber">
                      {KIND_LABELS[sug.kind] || sug.kind}
                    </span>
                    <span>{summarizeSuggestion(sug.changes)}</span>
                  </div>
                  <div className="adm-row-sub adm-mono">
                    {JSON.stringify(sug.changes)}
                  </div>
                </div>

                <div className="adm-row-right">
                  <span className="adm-muted adm-tnum">
                    {formatShortDate(sug.created_at)}
                  </span>
                  {sug.place_id ? (
                    <Link
                      href={`/admin/estabelecimentos/${sug.place_id}`}
                      className="adm-btn adm-btn-secondary adm-btn-xs"
                    >
                      Local
                    </Link>
                  ) : null}
                  {sug.status === "pending" ? (
                    <>
                      <button
                        type="button"
                        disabled={Boolean(revisandoId)}
                        onClick={() => revisar(sug.id, "accepted")}
                        className="adm-btn adm-btn-primary adm-btn-xs"
                      >
                        Aceitar
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(revisandoId)}
                        onClick={() => revisar(sug.id, "rejected")}
                        className="adm-btn adm-btn-danger adm-btn-xs"
                      >
                        Recusar
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PanelCard>
  );
}
