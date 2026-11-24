import dynamic from "next/dynamic";
import { useState } from "react";

const MapaCoordenadas = dynamic(
  () => import("components/admin/MapaCoordenadas.js"),
  {
    ssr: false,
    loading: () => (
      <div
        className="adm-map-box"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span className="adm-muted">Carregando mapa...</span>
      </div>
    ),
  },
);

const INITIAL_EMPTY = {
  name: "",
  category: "",
  street: "",
  neighborhood: "",
  locality: "",
  region: "",
  postcode: "",
  latitude: "-23.550520",
  longitude: "-46.633308",
};

function toFormState(initialValues) {
  if (!initialValues) return { ...INITIAL_EMPTY };
  return {
    name: initialValues.name ?? "",
    category: initialValues.category ?? "",
    street: initialValues.street ?? "",
    neighborhood: initialValues.neighborhood ?? "",
    locality: initialValues.locality ?? "",
    region: initialValues.region ?? "",
    postcode: initialValues.postcode ?? "",
    latitude:
      initialValues.latitude !== undefined && initialValues.latitude !== null
        ? String(initialValues.latitude)
        : "",
    longitude:
      initialValues.longitude !== undefined && initialValues.longitude !== null
        ? String(initialValues.longitude)
        : "",
  };
}

export default function PlaceForm({
  initialValues = null,
  referencia = null,
  submitLabel = "Salvar estabelecimento",
  salvando = false,
  onSubmit,
  extraActions = null,
}) {
  const [form, setForm] = useState(() => toFormState(initialValues));
  const [erroLocal, setErroLocal] = useState(null);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function aplicarReferencia() {
    if (!referencia) return;
    setForm((prev) => ({
      ...prev,
      latitude: String(referencia.latitude),
      longitude: String(referencia.longitude),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setErroLocal(null);

    const lat = Number(String(form.latitude).replace(",", "."));
    const lon = Number(String(form.longitude).replace(",", "."));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      setErroLocal("Informe latitude e longitude numéricas válidas.");
      return;
    }

    await onSubmit({
      name: form.name,
      category: form.category || null,
      street: form.street || null,
      neighborhood: form.neighborhood || null,
      locality: form.locality || null,
      region: form.region || null,
      postcode: form.postcode || null,
      latitude: lat,
      longitude: lon,
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      {erroLocal ? (
        <div className="adm-alert adm-alert-error" role="alert">
          {erroLocal}
        </div>
      ) : null}

      <div className="adm-split">
        <div>
          <div className="adm-field">
            <label htmlFor="place-name" className="adm-field-label">
              Nome do estabelecimento *
            </label>
            <input
              id="place-name"
              type="text"
              required
              maxLength={200}
              className="adm-input"
              value={form.name}
              onChange={(event) => setField("name", event.target.value)}
            />
          </div>

          <div className="adm-form-grid">
            <div className="adm-field">
              <label htmlFor="place-category" className="adm-field-label">
                Categoria
              </label>
              <input
                id="place-category"
                type="text"
                maxLength={200}
                placeholder="ex.: restaurant, cafe, bar"
                className="adm-input"
                value={form.category}
                onChange={(event) => setField("category", event.target.value)}
              />
            </div>

            <div className="adm-field">
              <label htmlFor="place-postcode" className="adm-field-label">
                CEP
              </label>
              <input
                id="place-postcode"
                type="text"
                maxLength={200}
                className="adm-input"
                value={form.postcode}
                onChange={(event) => setField("postcode", event.target.value)}
              />
            </div>
          </div>

          <div className="adm-field">
            <label htmlFor="place-street" className="adm-field-label">
              Rua e número
            </label>
            <input
              id="place-street"
              type="text"
              maxLength={200}
              className="adm-input"
              value={form.street}
              onChange={(event) => setField("street", event.target.value)}
            />
          </div>

          <div className="adm-form-grid">
            <div className="adm-field">
              <label htmlFor="place-neighborhood" className="adm-field-label">
                Bairro
              </label>
              <input
                id="place-neighborhood"
                type="text"
                maxLength={200}
                className="adm-input"
                value={form.neighborhood}
                onChange={(event) =>
                  setField("neighborhood", event.target.value)
                }
              />
            </div>

            <div className="adm-field">
              <label htmlFor="place-locality" className="adm-field-label">
                Cidade
              </label>
              <input
                id="place-locality"
                type="text"
                maxLength={200}
                className="adm-input"
                value={form.locality}
                onChange={(event) => setField("locality", event.target.value)}
              />
            </div>

            <div className="adm-field">
              <label htmlFor="place-region" className="adm-field-label">
                Estado (UF)
              </label>
              <input
                id="place-region"
                type="text"
                maxLength={200}
                className="adm-input"
                value={form.region}
                onChange={(event) => setField("region", event.target.value)}
              />
            </div>
          </div>

          <div className="adm-form-grid">
            <div className="adm-field">
              <label htmlFor="place-lat" className="adm-field-label">
                Latitude *
              </label>
              <input
                id="place-lat"
                type="text"
                required
                className="adm-input adm-mono"
                value={form.latitude}
                onChange={(event) => setField("latitude", event.target.value)}
              />
            </div>

            <div className="adm-field">
              <label htmlFor="place-lon" className="adm-field-label">
                Longitude *
              </label>
              <input
                id="place-lon"
                type="text"
                required
                className="adm-input adm-mono"
                value={form.longitude}
                onChange={(event) => setField("longitude", event.target.value)}
              />
            </div>
          </div>

          <div className="adm-row" style={{ marginTop: 4 }}>
            <button
              type="submit"
              disabled={salvando}
              className="adm-btn adm-btn-primary adm-btn-sm"
            >
              {salvando ? "Salvando..." : submitLabel}
            </button>
            {extraActions}
          </div>
        </div>

        <div>
          <p className="adm-field-label" style={{ margin: "0 0 4px" }}>
            Posição no mapa
          </p>
          <MapaCoordenadas
            latitude={form.latitude}
            longitude={form.longitude}
            referencia={referencia}
            onChange={({ latitude, longitude }) => {
              setField("latitude", String(latitude));
              setField("longitude", String(longitude));
            }}
          />

          {referencia ? (
            <div className="adm-alert adm-alert-warn" style={{ marginTop: 12 }}>
              <p style={{ margin: "0 0 8px", fontSize: "0.875rem" }}>
                Coordenada de referência enviada (pino âmbar):{" "}
                <span className="adm-mono">
                  {referencia.latitude}, {referencia.longitude}
                </span>
              </p>
              <button
                type="button"
                onClick={aplicarReferencia}
                className="adm-btn adm-btn-secondary adm-btn-sm"
              >
                Usar esta coordenada
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </form>
  );
}
