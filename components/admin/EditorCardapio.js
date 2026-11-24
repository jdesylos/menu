import { useState } from "react";
import { apiFetch, centsToInput, parsePriceToCents } from "lib/adminApi.js";

function emptyItem() {
  return {
    id: undefined,
    name: "",
    ingredients: "",
    priceText: "",
  };
}

function fromMenuToState(menu) {
  if (!menu || !Array.isArray(menu.sections) || menu.sections.length === 0) {
    return [
      {
        title: "Pratos principais",
        items: [emptyItem()],
      },
    ];
  }

  return menu.sections.map((section) => ({
    title: section.title ?? "",
    items: (section.items || []).map((item) => ({
      id: item.id,
      name: item.name ?? "",
      ingredients: item.ingredients ?? "",
      priceText: centsToInput(item.price_cents),
    })),
  }));
}

export default function EditorCardapio({
  placeId,
  initialMenu = null,
  onSaved,
}) {
  const [menuAtual, setMenuAtual] = useState(initialMenu);
  const [currency, setCurrency] = useState(initialMenu?.currency || "BRL");
  const [sections, setSections] = useState(() => fromMenuToState(initialMenu));
  const [erro, setErro] = useState(null);
  const [sucesso, setSucesso] = useState(null);
  const [salvando, setSalvando] = useState(false);

  function addSection() {
    setSections((prev) => [...prev, { title: "", items: [emptyItem()] }]);
  }

  function removeSection(sectionIdx) {
    setSections((prev) => prev.filter((_, idx) => idx !== sectionIdx));
  }

  function updateSectionTitle(sectionIdx, value) {
    setSections((prev) =>
      prev.map((sec, idx) =>
        idx === sectionIdx ? { ...sec, title: value } : sec,
      ),
    );
  }

  function addItem(sectionIdx) {
    setSections((prev) =>
      prev.map((sec, idx) =>
        idx === sectionIdx
          ? { ...sec, items: [...sec.items, emptyItem()] }
          : sec,
      ),
    );
  }

  function updateItem(sectionIdx, itemIdx, key, value) {
    setSections((prev) =>
      prev.map((sec, sIdx) =>
        sIdx === sectionIdx
          ? {
              ...sec,
              items: sec.items.map((item, iIdx) =>
                iIdx === itemIdx ? { ...item, [key]: value } : item,
              ),
            }
          : sec,
      ),
    );
  }

  function removeItem(sectionIdx, itemIdx) {
    setSections((prev) =>
      prev.map((sec, sIdx) =>
        sIdx === sectionIdx
          ? {
              ...sec,
              items: sec.items.filter((_, iIdx) => iIdx !== itemIdx),
            }
          : sec,
      ),
    );
  }

  function moveSection(sectionIdx, delta) {
    const target = sectionIdx + delta;
    if (target < 0 || target >= sections.length) return;
    setSections((prev) => {
      const next = [...prev];
      const [moved] = next.splice(sectionIdx, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErro(null);
    setSucesso(null);

    const payloadSections = [];
    for (let sIdx = 0; sIdx < sections.length; sIdx++) {
      const sec = sections[sIdx];
      const payloadItems = [];
      for (let iIdx = 0; iIdx < sec.items.length; iIdx++) {
        const item = sec.items[iIdx];
        const priceCents = parsePriceToCents(item.priceText);
        if (Number.isNaN(priceCents)) {
          setErro(
            `O preço "${item.priceText}" do prato "${item.name || iIdx + 1}" é inválido.`,
          );
          return;
        }
        payloadItems.push({
          ...(menuAtual?.id && item.id ? { id: item.id } : {}),
          name: item.name,
          ingredients: item.ingredients,
          price_cents: priceCents,
        });
      }
      payloadSections.push({
        title: sec.title,
        items: payloadItems,
      });
    }

    setSalvando(true);
    try {
      const saved = await apiFetch(
        `/api/v1/admin/menus/${encodeURIComponent(placeId)}`,
        {
          method: "PUT",
          body: {
            currency,
            ...(menuAtual?.id ? { replaces: menuAtual.id } : {}),
            sections: payloadSections,
          },
        },
      );
      setMenuAtual(saved);
      setSections(fromMenuToState(saved));
      setSucesso("Nova revisão do cardápio salva e publicada para o app.");
      onSaved?.(saved);
    } catch (error) {
      setErro(error.message);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
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

      <div className="adm-row-between" style={{ marginBottom: 10 }}>
        <div className="adm-row">
          <label htmlFor="menu-currency" className="adm-field-label">
            Moeda
          </label>
          <select
            id="menu-currency"
            className="adm-select adm-select-inline"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            <option value="BRL">BRL (R$)</option>
            <option value="USD">USD (US$)</option>
            <option value="EUR">EUR (€)</option>
          </select>
        </div>

        <button
          type="button"
          onClick={addSection}
          className="adm-btn adm-btn-secondary adm-btn-sm"
        >
          + Seção
        </button>
      </div>

      {sections.map((section, sIdx) => (
        <div key={sIdx} className="adm-section-box">
          <div className="adm-row-between">
            <div style={{ flex: 1, minWidth: 200 }}>
              <input
                type="text"
                maxLength={200}
                placeholder="Título da seção (ex.: Entradas, Bebidas — opcional)"
                aria-label={`Título da seção ${sIdx + 1}`}
                className="adm-input"
                value={section.title}
                onChange={(event) =>
                  updateSectionTitle(sIdx, event.target.value)
                }
              />
            </div>

            <div className="adm-row">
              <button
                type="button"
                onClick={() => moveSection(sIdx, -1)}
                disabled={sIdx === 0}
                className="adm-btn adm-btn-secondary adm-btn-sm"
              >
                Subir
              </button>
              <button
                type="button"
                onClick={() => moveSection(sIdx, 1)}
                disabled={sIdx === sections.length - 1}
                className="adm-btn adm-btn-secondary adm-btn-sm"
              >
                Descer
              </button>
              <button
                type="button"
                onClick={() => removeSection(sIdx)}
                disabled={sections.length <= 1}
                className="adm-btn adm-btn-danger adm-btn-sm"
              >
                Remover seção
              </button>
            </div>
          </div>

          {section.items.map((item, iIdx) => (
            <div
              key={item.id || `new-${sIdx}-${iIdx}`}
              className="adm-item-row"
            >
              <input
                type="text"
                required
                maxLength={200}
                placeholder="Nome do prato *"
                aria-label="Nome do prato"
                className="adm-input"
                value={item.name}
                onChange={(event) =>
                  updateItem(sIdx, iIdx, "name", event.target.value)
                }
              />
              <input
                type="text"
                maxLength={1000}
                placeholder="Ingredientes / descrição"
                aria-label="Ingredientes ou descrição"
                className="adm-input"
                value={item.ingredients}
                onChange={(event) =>
                  updateItem(sIdx, iIdx, "ingredients", event.target.value)
                }
              />
              <input
                type="text"
                placeholder="42,00"
                aria-label="Preço"
                className="adm-input"
                value={item.priceText}
                onChange={(event) =>
                  updateItem(sIdx, iIdx, "priceText", event.target.value)
                }
              />
              <button
                type="button"
                onClick={() => removeItem(sIdx, iIdx)}
                className="adm-btn adm-btn-secondary adm-btn-sm"
              >
                Remover
              </button>
            </div>
          ))}

          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => addItem(sIdx)}
              className="adm-btn adm-btn-secondary adm-btn-xs"
            >
              + Prato
            </button>
          </div>
        </div>
      ))}

      <button
        type="submit"
        disabled={salvando}
        className="adm-btn adm-btn-primary adm-btn-sm"
      >
        {salvando ? "Salvando..." : "Salvar cardápio"}
      </button>
    </form>
  );
}
