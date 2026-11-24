import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import PanelCard, {
  PaginationBar,
  SearchIcon,
  SupportIcon,
} from "components/admin/PanelCard.js";
import { apiFetch, formatDateTime, formatShortDate } from "lib/adminApi.js";

const CATEGORY_META = {
  missing_place: { label: "Local faltante", pill: "adm-pill-blue" },
  account_help: { label: "Ajuda de conta", pill: "adm-pill-amber" },
  general_help: { label: "Ajuda geral", pill: "adm-pill-neutral" },
};

const STATUS_META = {
  open: { label: "Em aberto", pill: "adm-pill-amber", rail: "is-amber" },
  in_progress: { label: "Em análise", pill: "adm-pill-blue", rail: "is-blue" },
  resolved: { label: "Resolvida", pill: "adm-pill-green", rail: "is-green" },
  archived: { label: "Arquivada", pill: "adm-pill-neutral", rail: "" },
};

function getTitle(item) {
  if (item.category === "missing_place") {
    return item.place_name || "(local sem nome)";
  }
  return item.subject || CATEGORY_META[item.category]?.label || "Solicitação";
}

function getPreview(item) {
  if (item.category === "missing_place") {
    return item.approximate_address || item.message || "Sem endereço informado";
  }
  return item.message || "Sem mensagem";
}

export default function SupportCockpitPanel({
  initialRequests,
  canManagePlace = false,
  onOpenCountChange = null,
  onCreatePlaceFromSupport = null,
  refreshSignal = 0,
}) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [resultado, setResultado] = useState(initialRequests);
  const [buscando, setBuscando] = useState(false);
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);

  const [expandedId, setExpandedId] = useState(null);
  const [editStatus, setEditStatus] = useState("open");
  const [editNote, setEditNote] = useState("");
  const [editPlaceId, setEditPlaceId] = useState("");
  const [salvandoId, setSalvandoId] = useState(null);

  const lastRefreshRef = useRef(0);
  const queryRef = useRef({ q, category, status });
  queryRef.current = { q, category, status };

  async function buscar({
    nextPage = 1,
    nextCategory = queryRef.current.category,
    nextStatus = queryRef.current.status,
    nextQ = queryRef.current.q,
  } = {}) {
    setErro(null);
    setBuscando(true);
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: "12",
        category: nextCategory,
        status: nextStatus,
      });
      if (nextQ.trim()) params.set("q", nextQ.trim());

      const data = await apiFetch(
        `/api/v1/admin/support-requests?${params.toString()}`,
      );
      setResultado(data);
      const activeOpen =
        (data.counts?.open || 0) + (data.counts?.in_progress || 0);
      onOpenCountChange?.(activeOpen);
    } catch (error) {
      setErro(error.message);
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => {
    if (!refreshSignal || refreshSignal === lastRefreshRef.current) return;
    lastRefreshRef.current = refreshSignal;
    buscar({ nextPage: 1 });
    // Disparado apenas quando outro painel vincula/conclui uma solicitação.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  function toggleAtendimento(item) {
    if (expandedId === item.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(item.id);
    setEditStatus(item.status || "open");
    setEditNote(item.resolution_note || "");
    setEditPlaceId(item.resolved_place_id || "");
    setSucesso(null);
    setErro(null);
  }

  async function salvarAtendimento(event, item) {
    event.preventDefault();
    setErro(null);
    setSucesso(null);
    setSalvandoId(item.id);
    try {
      const payload = {
        status: editStatus,
        resolution_note: editNote.trim() || null,
      };
      if (item.category === "missing_place") {
        payload.resolved_place_id = editPlaceId.trim() || null;
      }

      await apiFetch(
        `/api/v1/admin/support-requests/${encodeURIComponent(item.id)}`,
        {
          method: "PATCH",
          body: payload,
        },
      );
      setExpandedId(null);
      await buscar({ nextPage: resultado?.page || 1 });
      setSucesso("Atendimento atualizado e registrado na auditoria.");
    } catch (error) {
      setErro(error.message);
    } finally {
      setSalvandoId(null);
    }
  }

  const items = resultado?.items || [];
  const counts = resultado?.counts || {
    open: 0,
    in_progress: 0,
    resolved: 0,
    archived: 0,
  };
  const openQueue = (counts.open || 0) + (counts.in_progress || 0);
  const totalPages = Math.max(
    1,
    Math.ceil((resultado?.total || 0) / (resultado?.limit || 12)),
  );

  return (
    <PanelCard
      id="solicitacoes"
      title="Solicitações e ajuda"
      subtitle="Atendimento"
      icon={<SupportIcon />}
      tone="attention"
      actions={
        <>
          {openQueue > 0 ? (
            <span className="adm-pill adm-pill-amber adm-tnum">
              {openQueue} em aberto
            </span>
          ) : null}
          <button
            type="button"
            disabled={buscando}
            onClick={() => buscar({ nextPage: resultado?.page || 1 })}
            className="adm-btn adm-btn-secondary adm-btn-xs"
          >
            {buscando ? "Atualizando…" : "Atualizar"}
          </button>
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

      <form
        onSubmit={(event) => {
          event.preventDefault();
          buscar({ nextPage: 1, nextQ: q });
        }}
        className="adm-toolbar"
      >
        <label className="adm-search-box">
          <SearchIcon />
          <input
            id="busca-suporte"
            name="support_search"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Local, e-mail, mensagem ou UUID…"
            aria-label="Local, e-mail, mensagem ou UUID"
            className="adm-search-input"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </label>

        <select
          id="filtro-suporte-cat"
          aria-label="Categoria da solicitação"
          className="adm-select adm-select-inline"
          value={category}
          onChange={(event) => {
            const next = event.target.value;
            setCategory(next);
            buscar({ nextPage: 1, nextCategory: next });
          }}
        >
          <option value="all">Todas categorias</option>
          <option value="missing_place">Local faltante</option>
          <option value="account_help">Ajuda de conta</option>
          <option value="general_help">Ajuda geral</option>
        </select>

        <select
          id="filtro-suporte-status"
          aria-label="Situação do atendimento"
          className="adm-select adm-select-inline"
          value={status}
          onChange={(event) => {
            const next = event.target.value;
            setStatus(next);
            buscar({ nextPage: 1, nextStatus: next });
          }}
        >
          <option value="all">Todas situações</option>
          <option value="open">Em aberto</option>
          <option value="in_progress">Em análise</option>
          <option value="resolved">Resolvidas</option>
          <option value="archived">Arquivadas</option>
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
          Nenhuma solicitação encontrada para este filtro.
        </p>
      ) : (
        <ul className="adm-list adm-list-compact">
          {items.map((item) => {
            const catMeta = CATEGORY_META[item.category] || {
              label: item.category,
              pill: "adm-pill-neutral",
            };
            const stMeta = STATUS_META[item.status] || STATUS_META.open;
            const isExpanded = expandedId === item.id;

            return (
              <li
                key={item.id}
                className="adm-list-row"
                style={{ flexDirection: "column", gap: 6 }}
              >
                <div
                  style={{ display: "flex", alignItems: "stretch", gap: 10 }}
                >
                  <span
                    aria-hidden="true"
                    className={`adm-rail ${stMeta.rail}`}
                  />

                  <div className="adm-row-main">
                    <div className="adm-row-title">
                      <span className={`adm-pill ${catMeta.pill}`}>
                        {catMeta.label}
                      </span>
                      <span className={`adm-pill ${stMeta.pill}`}>
                        {stMeta.label}
                      </span>
                      <span>{getTitle(item)}</span>
                    </div>
                    <div className="adm-row-sub">
                      {getPreview(item)} •{" "}
                      {item.contact_email ||
                        (item.user_username
                          ? `@${item.user_username}`
                          : "Sem login")}{" "}
                      •{" "}
                      <span className="adm-tnum">
                        {formatShortDate(item.created_at)}
                      </span>
                    </div>
                  </div>

                  <div className="adm-row-right">
                    {item.category === "missing_place" &&
                    canManagePlace &&
                    item.status !== "resolved" ? (
                      <button
                        type="button"
                        onClick={() => onCreatePlaceFromSupport?.(item)}
                        className="adm-btn adm-btn-primary adm-btn-xs"
                      >
                        Cadastrar local
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => toggleAtendimento(item)}
                      className="adm-btn adm-btn-secondary adm-btn-xs"
                    >
                      {isExpanded ? "Fechar" : "Atender"}
                    </button>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="adm-support-detail">
                    <div
                      style={{
                        display: "grid",
                        gap: 4,
                        fontSize: "0.8125rem",
                        marginBottom: 8,
                      }}
                    >
                      <div>
                        <strong>Solicitante:</strong>{" "}
                        {item.contact_name ? `${item.contact_name} • ` : ""}
                        {item.contact_email || "Sem e-mail informado"}
                        {item.user_id ? (
                          <>
                            {" "}
                            •{" "}
                            <Link
                              href={`/admin/usuarios/${item.user_id}`}
                              className="adm-link"
                            >
                              {item.user_username || "Ver conta"}
                            </Link>
                          </>
                        ) : null}
                      </div>

                      {item.account_identifier ? (
                        <div>
                          <strong>Identificador da conta:</strong>{" "}
                          <span className="adm-mono">
                            {item.account_identifier}
                          </span>
                        </div>
                      ) : null}

                      {item.category === "missing_place" ? (
                        <div>
                          <strong>Endereço aproximado:</strong>{" "}
                          {item.approximate_address || "—"}
                          {item.latitude !== null &&
                          item.latitude !== undefined ? (
                            <>
                              {" "}
                              •{" "}
                              <span className="adm-mono adm-tnum">
                                GPS: {Number(item.latitude).toFixed(5)},{" "}
                                {Number(item.longitude).toFixed(5)}
                              </span>
                            </>
                          ) : (
                            " • Sem localização enviada"
                          )}
                        </div>
                      ) : null}

                      {item.message ? (
                        <div style={{ whiteSpace: "pre-wrap" }}>
                          <strong>Detalhes:</strong> {item.message}
                        </div>
                      ) : null}

                      {item.resolved_place_id ? (
                        <div>
                          <strong>Local vinculado:</strong>{" "}
                          <Link
                            href={`/admin/estabelecimentos/${item.resolved_place_id}`}
                            className="adm-link"
                          >
                            {item.resolved_place_name || item.resolved_place_id}
                          </Link>
                        </div>
                      ) : null}

                      {item.handled_at ? (
                        <div className="adm-muted">
                          Última atualização por{" "}
                          {item.handled_username || "admin"} em{" "}
                          {formatDateTime(item.handled_at)}
                        </div>
                      ) : null}
                    </div>

                    <form onSubmit={(event) => salvarAtendimento(event, item)}>
                      <div className="adm-form-grid">
                        <div className="adm-field" style={{ marginBottom: 6 }}>
                          <label
                            htmlFor={`sup-status-${item.id}`}
                            className="adm-field-label"
                          >
                            Situação
                          </label>
                          <select
                            id={`sup-status-${item.id}`}
                            className="adm-select"
                            value={editStatus}
                            onChange={(e) => setEditStatus(e.target.value)}
                          >
                            <option value="open">Em aberto</option>
                            <option value="in_progress">Em análise</option>
                            <option value="resolved">Resolvida</option>
                            <option value="archived">Arquivada</option>
                          </select>
                        </div>

                        {item.category === "missing_place" ? (
                          <div
                            className="adm-field"
                            style={{ marginBottom: 6 }}
                          >
                            <label
                              htmlFor={`sup-place-${item.id}`}
                              className="adm-field-label"
                            >
                              UUID do local vinculado
                            </label>
                            <input
                              id={`sup-place-${item.id}`}
                              type="text"
                              placeholder="Opcional"
                              className="adm-input adm-mono"
                              value={editPlaceId}
                              onChange={(e) => setEditPlaceId(e.target.value)}
                            />
                          </div>
                        ) : null}
                      </div>

                      <div className="adm-field" style={{ marginBottom: 8 }}>
                        <label
                          htmlFor={`sup-note-${item.id}`}
                          className="adm-field-label"
                        >
                          Nota de atendimento / conclusão
                        </label>
                        <textarea
                          id={`sup-note-${item.id}`}
                          rows={2}
                          maxLength={2000}
                          placeholder="Registre o retorno dado ou o que foi ajustado…"
                          className="adm-textarea"
                          value={editNote}
                          onChange={(e) => setEditNote(e.target.value)}
                        />
                      </div>

                      <div className="adm-row">
                        <button
                          type="submit"
                          disabled={salvandoId === item.id}
                          className="adm-btn adm-btn-dark adm-btn-xs"
                        >
                          {salvandoId === item.id
                            ? "Salvando…"
                            : "Salvar atendimento"}
                        </button>
                      </div>
                    </form>
                  </div>
                ) : null}
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
  );
}
