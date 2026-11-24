import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import PanelCard, {
  PaginationBar,
  SearchIcon,
  StoreIcon,
} from "components/admin/PanelCard.js";
import PlaceForm from "components/admin/PlaceForm.js";
import { apiFetch } from "lib/adminApi.js";

const REASON_LABELS = {
  admin_removed: "Excluído no painel",
  reported_closed: "Fechado (usuário)",
  reported_duplicate: "Duplicata (usuário)",
  closed: "Fechado (fonte)",
  duplicate: "Duplicata (fonte)",
  missing_from_source: "Ausente na fonte",
};

function formatAddress(item) {
  const parts = [
    item.street,
    item.neighborhood,
    item.locality,
    item.region,
    item.postcode,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" • ") : "Sem endereço informado";
}

export default function PlacesCockpitPanel({
  initialQuery,
  initialPlaces,
  filterCommand = null,
  onFilterStateChange = null,
}) {
  const router = useRouter();
  const [mostrarNovo, setMostrarNovo] = useState(false);
  const [q, setQ] = useState(initialQuery?.q || "");
  const [visibility, setVisibility] = useState(
    initialQuery?.visibility || "all",
  );
  const [hasMenu, setHasMenu] = useState(initialQuery?.has_menu || "all");
  const [resultado, setResultado] = useState(initialPlaces);
  const [buscando, setBuscando] = useState(false);
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState(null);
  const lastSeqRef = useRef(0);
  const qRef = useRef(q);
  qRef.current = q;

  async function buscarLocais({
    nextPage = 1,
    nextQ = qRef.current,
    nextVis = visibility,
    nextMenu = hasMenu,
  } = {}) {
    setErro(null);
    setBuscando(true);
    onFilterStateChange?.({ visibility: nextVis, hasMenu: nextMenu });
    try {
      const params = new URLSearchParams({
        page: String(nextPage),
        limit: "12",
        visibility: nextVis,
        has_menu: nextMenu,
      });
      if (nextQ.trim()) {
        params.set("q", nextQ.trim());
      }
      const data = await apiFetch(`/api/v1/admin/places?${params.toString()}`);
      setResultado(data);
    } catch (error) {
      setErro(error.message);
    } finally {
      setBuscando(false);
    }
  }

  useEffect(() => {
    if (!filterCommand || filterCommand.seq === lastSeqRef.current) return;
    lastSeqRef.current = filterCommand.seq;
    const nextVis = filterCommand.visibility ?? "all";
    const nextMenu = filterCommand.hasMenu ?? "all";
    setVisibility(nextVis);
    setHasMenu(nextMenu);
    buscarLocais({
      nextPage: 1,
      nextQ: qRef.current,
      nextVis,
      nextMenu,
    });
    // Disparado apenas por incremento explícito de `filterCommand.seq` nos KPIs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCommand]);

  async function criarLocal(payload) {
    setErro(null);
    setCriando(true);
    try {
      const created = await apiFetch("/api/v1/admin/places", {
        method: "POST",
        body: payload,
      });
      router.push(`/admin/estabelecimentos/${created.id}`);
    } catch (error) {
      setErro(error.message);
      setCriando(false);
    }
  }

  function limparFiltros() {
    setQ("");
    setVisibility("all");
    setHasMenu("all");
    buscarLocais({ nextPage: 1, nextQ: "", nextVis: "all", nextMenu: "all" });
  }

  const items = resultado?.items || [];
  const hasActiveFilters =
    Boolean(q.trim()) || visibility !== "all" || hasMenu !== "all";

  return (
    <PanelCard
      id="locais"
      title="Estabelecimentos e cardápios"
      subtitle="Base ~600k"
      icon={<StoreIcon />}
      tone="primary"
      actions={
        <>
          <span className="adm-muted adm-tnum">
            {resultado?.total !== null && resultado?.total !== undefined
              ? `${resultado.total} encontrado(s)`
              : "Listagem aberta"}
          </span>
          {hasActiveFilters ? (
            <button
              type="button"
              onClick={limparFiltros}
              disabled={buscando}
              className="adm-btn adm-btn-secondary adm-btn-xs"
            >
              Limpar
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setMostrarNovo((v) => !v)}
            className="adm-btn adm-btn-primary adm-btn-xs"
          >
            {mostrarNovo ? "Fechar" : "+ Novo local"}
          </button>
        </>
      }
    >
      {erro ? (
        <div className="adm-alert adm-alert-error" role="alert">
          {erro}
        </div>
      ) : null}

      {mostrarNovo ? (
        <div
          style={{
            marginBottom: 12,
            paddingBottom: 12,
            borderBottom: "1px solid #E3E9ED",
          }}
        >
          <PlaceForm
            submitLabel="Criar estabelecimento"
            salvando={criando}
            onSubmit={criarLocal}
            extraActions={
              <button
                type="button"
                onClick={() => setMostrarNovo(false)}
                className="adm-btn adm-btn-secondary adm-btn-sm"
              >
                Cancelar
              </button>
            }
          />
        </div>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          buscarLocais({ nextPage: 1, nextQ: q });
        }}
        className="adm-toolbar"
      >
        <label className="adm-search-box">
          <SearchIcon />
          <input
            id="busca-local"
            name="place_search"
            type="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="Nome, endereço, bairro ou UUID…"
            aria-label="Nome, endereço, bairro ou UUID"
            className="adm-search-input"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
        </label>

        <select
          id="filtro-vis"
          aria-label="Visibilidade no mapa"
          className="adm-select adm-select-inline"
          value={visibility}
          onChange={(event) => {
            const next = event.target.value;
            setVisibility(next);
            buscarLocais({ nextPage: 1, nextQ: q, nextVis: next });
          }}
        >
          <option value="all">Todos status</option>
          <option value="visible">Visíveis</option>
          <option value="hidden">Excluídos</option>
        </select>

        <select
          id="filtro-menu"
          aria-label="Cardápio"
          className="adm-select adm-select-inline"
          value={hasMenu}
          onChange={(event) => {
            const next = event.target.value;
            setHasMenu(next);
            buscarLocais({ nextPage: 1, nextQ: q, nextMenu: next });
          }}
        >
          <option value="all">Cardápio: todos</option>
          <option value="true">Com cardápio</option>
          <option value="false">Sem cardápio</option>
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
          Nenhum estabelecimento encontrado para este filtro.
        </p>
      ) : (
        <ul className="adm-list adm-list-compact">
          {items.map((item) => {
            const railClass = item.hidden_at
              ? "is-amber"
              : item.has_menu
                ? "is-green"
                : "is-blue";

            return (
              <li key={item.id} className="adm-list-row">
                <span aria-hidden="true" className={`adm-rail ${railClass}`} />

                <div className="adm-row-main">
                  <div className="adm-row-title">
                    <span>{item.name}</span>
                    {item.hidden_at ? (
                      <span className="adm-pill adm-pill-amber">
                        {REASON_LABELS[item.hidden_reason] || "Excluído"}
                      </span>
                    ) : (
                      <span className="adm-pill adm-pill-green">Visível</span>
                    )}
                    {item.has_menu ? (
                      <span className="adm-pill adm-pill-blue">Cardápio</span>
                    ) : null}
                  </div>
                  <div className="adm-row-sub">
                    {formatAddress(item)} • {item.category || "Sem categoria"} •{" "}
                    <span className="adm-mono adm-tnum">
                      {Number(item.latitude).toFixed(4)},
                      {Number(item.longitude).toFixed(4)}
                    </span>
                  </div>
                </div>

                <div className="adm-row-right">
                  <Link
                    href={`/admin/estabelecimentos/${item.id}#cardapio`}
                    className="adm-btn adm-btn-secondary adm-btn-xs"
                  >
                    Cardápio
                  </Link>
                  <Link
                    href={`/admin/estabelecimentos/${item.id}`}
                    className="adm-btn adm-btn-secondary adm-btn-xs"
                  >
                    Editar
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <PaginationBar
        page={resultado?.page || 1}
        hasNext={Boolean(resultado?.has_next)}
        busy={buscando}
        onPageChange={(nextPage) => buscarLocais({ nextPage, nextQ: q })}
      />
    </PanelCard>
  );
}
