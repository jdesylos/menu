import * as maplibregl from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

const CENTRO_PADRAO = [-46.633308, -23.55052];
const DB_MIN_ZOOM = 14;
const DB_LABEL_MIN_ZOOM = 15;

// Paleta exata do mapa no aplicativo nativo (`menuspoiler/src/map/mod.rs` e `ui/theme.rs`).
const APP_MAP_COLORS = {
  earth: "#1F1F24",
  water: "#1A2E4D",
  landuse: "#212B24",
  roads: "#595961",
  buildings: "#2E2E36",
  roadLabel: "rgba(255, 255, 255, 0.72)",
  primary: "#1FB2E8",
  menuGreen: "#22B573",
  white: "#FFFFFF",
  hiddenFill: "#1F1F24",
  hiddenAccent: "#E6A23C",
  attentionAmber: "#A8620E",
};

// Ícone sólido Material Symbols (`restaurant_24px`), idêntico ao atlas `assets/icones.png` do app.
const RESTAURANT_GLYPH_PATH =
  "M280-80v-366q-51-14-85.5-56T160-600v-280h80v280h40v-280h80v280h40v-280h80v280q0 56-34.5 98T360-446v366h-80Zm400 0v-320H560v-280q0-83 58.5-141.5T760-880v800h-80Z";

// Largura proporcional a `LARGURA_DA_RUA_EM_PONTOS = 2.5` sobre tiles de 512 pt
// em z15, acompanhando o overzoom acima de z15 como no shader do aplicativo.
function roadWidthExpression() {
  return [
    "interpolate",
    ["exponential", 2],
    ["zoom"],
    10,
    1.2,
    14,
    2.0,
    15,
    2.5,
    16,
    5,
    17,
    10,
    18,
    20,
    19,
    40,
  ];
}

// Ordem exata das 5 camadas planas de `Camada::TODAS`:
// Earth -> Water -> Landuse -> Roads -> Buildings (100% opaco) + nomes de rua brancos a 0.72.
function buildProtomapsStyle(origin) {
  return {
    version: 8,
    glyphs:
      "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
    sources: {
      protomaps: {
        type: "vector",
        tiles: [`${origin}/api/v1/tiles/{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: 15,
        attribution: "© OpenStreetMap • Overture Maps",
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": APP_MAP_COLORS.earth },
      },
      {
        id: "earth",
        type: "fill",
        source: "protomaps",
        "source-layer": "earth",
        paint: { "fill-color": APP_MAP_COLORS.earth },
      },
      {
        id: "water",
        type: "fill",
        source: "protomaps",
        "source-layer": "water",
        paint: { "fill-color": APP_MAP_COLORS.water },
      },
      {
        id: "landuse",
        type: "fill",
        source: "protomaps",
        "source-layer": "landuse",
        paint: { "fill-color": APP_MAP_COLORS.landuse },
      },
      {
        id: "roads",
        type: "line",
        source: "protomaps",
        "source-layer": "roads",
        filter: ["==", ["geometry-type"], "LineString"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": APP_MAP_COLORS.roads,
          "line-width": roadWidthExpression(),
        },
      },
      {
        id: "buildings",
        type: "fill",
        source: "protomaps",
        "source-layer": "buildings",
        minzoom: 13,
        paint: {
          "fill-color": APP_MAP_COLORS.buildings,
          "fill-opacity": 1,
        },
      },
      {
        id: "roads-labels",
        type: "symbol",
        source: "protomaps",
        "source-layer": "roads",
        minzoom: 14,
        filter: [
          "all",
          ["==", ["geometry-type"], "LineString"],
          ["in", ["get", "kind"], ["literal", ["major_road", "minor_road"]]],
        ],
        layout: {
          "symbol-placement": "line",
          "text-field": ["coalesce", ["get", "name:pt"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "symbol-spacing": 220,
        },
        paint: {
          "text-color": APP_MAP_COLORS.roadLabel,
        },
      },
    ],
  };
}

// Quando `PROTOMAPS_API_KEY` não existe no ambiente local, usa tiles vetoriais abertos
// do OpenFreeMap (sem chave) aplicando exatamente as mesmas 5 camadas planas do app.
function buildOpenFreeMapStyle() {
  return {
    version: 8,
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      openfreemap: {
        type: "vector",
        url: "https://tiles.openfreemap.org/planet",
        attribution: "© OpenStreetMap • OpenFreeMap • Overture Maps",
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": APP_MAP_COLORS.earth },
      },
      {
        id: "water",
        type: "fill",
        source: "openfreemap",
        "source-layer": "water",
        paint: { "fill-color": APP_MAP_COLORS.water },
      },
      {
        id: "waterway",
        type: "line",
        source: "openfreemap",
        "source-layer": "waterway",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": APP_MAP_COLORS.water,
          "line-width": [
            "interpolate",
            ["linear"],
            ["zoom"],
            10,
            1,
            15,
            2.5,
            18,
            6,
          ],
        },
      },
      {
        id: "landcover-green",
        type: "fill",
        source: "openfreemap",
        "source-layer": "landcover",
        filter: ["in", ["get", "class"], ["literal", ["grass", "wood"]]],
        paint: { "fill-color": APP_MAP_COLORS.landuse },
      },
      {
        id: "park",
        type: "fill",
        source: "openfreemap",
        "source-layer": "park",
        paint: { "fill-color": APP_MAP_COLORS.landuse },
      },
      {
        id: "roads",
        type: "line",
        source: "openfreemap",
        "source-layer": "transportation",
        filter: [
          "all",
          ["==", ["geometry-type"], "LineString"],
          [
            "!",
            [
              "in",
              ["get", "class"],
              ["literal", ["transit", "rail", "ferry", "aerialway"]],
            ],
          ],
        ],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": APP_MAP_COLORS.roads,
          "line-width": roadWidthExpression(),
        },
      },
      {
        id: "buildings",
        type: "fill",
        source: "openfreemap",
        "source-layer": "building",
        minzoom: 13,
        paint: {
          "fill-color": APP_MAP_COLORS.buildings,
          "fill-opacity": 1,
        },
      },
      {
        id: "roads-labels",
        type: "symbol",
        source: "openfreemap",
        "source-layer": "transportation_name",
        minzoom: 14,
        filter: [
          "all",
          ["==", ["geometry-type"], "LineString"],
          [
            "in",
            ["get", "class"],
            [
              "literal",
              [
                "motorway",
                "trunk",
                "primary",
                "secondary",
                "tertiary",
                "minor",
              ],
            ],
          ],
        ],
        layout: {
          "symbol-placement": "line",
          "text-field": ["coalesce", ["get", "name:pt"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 12,
          "symbol-spacing": 220,
        },
        paint: {
          "text-color": APP_MAP_COLORS.roadLabel,
        },
      },
    ],
  };
}

function drawRestaurantGlyph(ctx, centerPx, glyphSidePx, fillColor) {
  const scale = glyphSidePx / 960;
  ctx.save();
  ctx.translate(centerPx - (960 * scale) / 2, centerPx + (960 * scale) / 2);
  ctx.scale(scale, scale);
  ctx.fillStyle = fillColor;
  ctx.fill(new Path2D(RESTAURANT_GLYPH_PATH));
  ctx.restore();
}

// Disco sólido 28x28 (@2x -> bitmap 56x56), exatamente como `RAIO_DA_COMIDA = 14` no app.
function createMarkerBitmap({ fill, glyphColor, ringColor = null }) {
  const size = 56;
  const center = size / 2;
  const radius = 27;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();

  if (ringColor) {
    ctx.setLineDash([7, 5]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = ringColor;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Proporção do app: `lado = raio * 1.1` (30.8 px no bitmap 56x56).
  drawRestaurantGlyph(ctx, center, radius * 1.1, glyphColor);
  return ctx.getImageData(0, 0, size, size);
}

function registerPlaceIcons(map) {
  if (!map.hasImage("place-empty")) {
    map.addImage(
      "place-empty",
      createMarkerBitmap({
        fill: APP_MAP_COLORS.white,
        glyphColor: APP_MAP_COLORS.primary,
      }),
      { pixelRatio: 2 },
    );
  }
  if (!map.hasImage("place-menu")) {
    map.addImage(
      "place-menu",
      createMarkerBitmap({
        fill: APP_MAP_COLORS.menuGreen,
        glyphColor: APP_MAP_COLORS.white,
      }),
      { pixelRatio: 2 },
    );
  }
  if (!map.hasImage("place-hidden")) {
    map.addImage(
      "place-hidden",
      createMarkerBitmap({
        fill: APP_MAP_COLORS.hiddenFill,
        glyphColor: APP_MAP_COLORS.hiddenAccent,
        ringColor: APP_MAP_COLORS.hiddenAccent,
      }),
      { pixelRatio: 2 },
    );
  }
}

function ensurePlacesOverlay(map, geojson) {
  registerPlaceIcons(map);

  const existing = map.getSource("db-places");
  if (existing) {
    existing.setData(geojson);
    return;
  }

  map.addSource("db-places", {
    type: "geojson",
    data: geojson,
  });

  map.addLayer({
    id: "db-places-layer",
    type: "symbol",
    source: "db-places",
    minzoom: DB_MIN_ZOOM,
    layout: {
      "icon-image": [
        "case",
        ["get", "is_hidden"],
        "place-hidden",
        ["get", "has_menu"],
        "place-menu",
        "place-empty",
      ],
      "icon-allow-overlap": true,
      "icon-size": 1,
    },
  });

  map.addLayer({
    id: "db-places-labels",
    type: "symbol",
    source: "db-places",
    minzoom: DB_LABEL_MIN_ZOOM,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Regular"],
      "text-size": 12.5,
      "text-anchor": "top",
      "text-offset": [0, 1.35],
      "text-max-width": 12,
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": [
        "case",
        ["get", "is_hidden"],
        APP_MAP_COLORS.hiddenAccent,
        APP_MAP_COLORS.white,
      ],
    },
  });
}

function createTargetElement() {
  const wrap = document.createElement("div");
  wrap.title = "Posição do estabelecimento (arraste para ajustar)";
  wrap.style.width = "38px";
  wrap.style.height = "38px";
  wrap.style.borderRadius = "999px";
  wrap.style.background = "rgba(31, 178, 232, 0.30)";
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.justifyContent = "center";
  wrap.style.cursor = "grab";

  const ring = document.createElement("div");
  ring.style.width = "29px";
  ring.style.height = "29px";
  ring.style.borderRadius = "999px";
  ring.style.background = APP_MAP_COLORS.primary;
  ring.style.border = "2.5px solid #FFFFFF";
  ring.style.display = "flex";
  ring.style.alignItems = "center";
  ring.style.justifyContent = "center";
  ring.innerHTML = `<svg width="14" height="14" viewBox="0 -960 960 960" fill="#FFFFFF" aria-hidden="true"><path d="${RESTAURANT_GLYPH_PATH}"/></svg>`;

  wrap.appendChild(ring);
  return wrap;
}

function createReferenceElement(label) {
  const el = document.createElement("div");
  el.title = label || "Referência enviada pelo usuário";
  el.style.width = "18px";
  el.style.height = "18px";
  el.style.borderRadius = "999px";
  el.style.background = APP_MAP_COLORS.attentionAmber;
  el.style.border = "2px solid #FFFFFF";
  el.style.boxShadow = "0 1px 4px rgba(0, 0, 0, 0.45)";
  return el;
}

function formatPopupAddress(props) {
  return [props.street, props.neighborhood, props.locality]
    .filter(Boolean)
    .join(" • ");
}

function createPopupContent(props) {
  const box = document.createElement("div");
  box.className = "adm-map-popup";

  const title = document.createElement("strong");
  title.className = "adm-map-popup-title";
  title.textContent = props.name || "Estabelecimento";
  box.appendChild(title);

  const badge = document.createElement("span");
  badge.className = `adm-pill ${
    props.is_hidden
      ? "adm-pill-amber"
      : props.has_menu
        ? "adm-pill-green"
        : "adm-pill-blue"
  }`;
  badge.style.marginBottom = "4px";
  badge.textContent = props.is_hidden
    ? "Excluído"
    : props.has_menu
      ? "Com cardápio"
      : "Sem cardápio";
  box.appendChild(badge);

  const addr = formatPopupAddress(props);
  if (addr) {
    const sub = document.createElement("div");
    sub.className = "adm-map-popup-sub";
    sub.textContent = addr;
    box.appendChild(sub);
  }

  const link = document.createElement("a");
  link.href = `/admin/estabelecimentos/${encodeURIComponent(props.id)}`;
  link.className = "adm-link";
  link.textContent = "Abrir local →";
  box.appendChild(link);

  return box;
}

function toGeoJson(places, currentPlaceId) {
  return {
    type: "FeatureCollection",
    features: (places || [])
      .filter((item) => item.id !== currentPlaceId)
      .map((item) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [Number(item.longitude), Number(item.latitude)],
        },
        properties: {
          id: item.id,
          name: item.name,
          street: item.street || "",
          neighborhood: item.neighborhood || "",
          locality: item.locality || "",
          has_menu: Boolean(item.has_menu),
          is_hidden: Boolean(item.hidden_at),
        },
      })),
  };
}

// Mapa interativo com renderização vetorial 1:1 do aplicativo (`menuspoiler`)
// e camada dos estabelecimentos já existentes no banco a partir do zoom 14.
export default function MapaCoordenadas({
  latitude,
  longitude,
  referencia = null,
  currentPlaceId = null,
  onChange,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const refMarkerRef = useRef(null);
  const popupRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const currentPlaceIdRef = useRef(currentPlaceId);
  const geojsonRef = useRef(toGeoJson([], currentPlaceId));
  const abortRef = useRef(null);
  const timerRef = useRef(null);
  const fallbackSwitchedRef = useRef(false);

  const [zoomWarning, setZoomWarning] = useState(false);
  const [dbCount, setDbCount] = useState(0);
  const [creditText, setCreditText] = useState(
    "© OpenStreetMap • Overture Maps",
  );

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    currentPlaceIdRef.current = currentPlaceId;
  }, [currentPlaceId]);

  const latNum = Number(latitude);
  const lonNum = Number(longitude);
  const hasCoords = Number.isFinite(latNum) && Number.isFinite(lonNum);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    let cancelled = false;
    let styleReady = false;
    const initialCenter = hasCoords ? [lonNum, latNum] : CENTRO_PADRAO;
    const initialZoom = hasCoords ? 17 : 12;

    async function fetchViewportPlaces(map) {
      const zoom = map.getZoom();
      if (zoom < DB_MIN_ZOOM) {
        setZoomWarning(true);
        setDbCount(0);
        geojsonRef.current = toGeoJson([], currentPlaceIdRef.current);
        if (styleReady) {
          ensurePlacesOverlay(map, geojsonRef.current);
        }
        return;
      }

      setZoomWarning(false);
      const b = map.getBounds();
      const params = new URLSearchParams({
        mode: "viewport",
        south: b.getSouth().toFixed(6),
        north: b.getNorth().toFixed(6),
        west: b.getWest().toFixed(6),
        east: b.getEast().toFixed(6),
      });

      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch(`/api/v1/admin/places?${params.toString()}`, {
          credentials: "same-origin",
          signal: ctrl.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const nextGeo = toGeoJson(data.places, currentPlaceIdRef.current);
        geojsonRef.current = nextGeo;
        setDbCount(nextGeo.features.length);
        if (styleReady) {
          ensurePlacesOverlay(map, nextGeo);
        }
      } catch {
        // Abort ou erro transitório de rede durante pan rápido.
      }
    }

    function scheduleViewportFetch(map) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        fetchViewportPlaces(map);
      }, 180);
    }

    async function initMap() {
      let useProtomaps = false;
      try {
        const cfg = await fetch("/api/v1/admin/places?mode=config", {
          credentials: "same-origin",
        });
        if (cfg.ok) {
          const json = await cfg.json();
          useProtomaps = Boolean(json.vector_tiles);
        }
      } catch {
        useProtomaps = false;
      }

      if (cancelled || !containerRef.current) return;

      setCreditText(
        useProtomaps
          ? "© OpenStreetMap • Overture Maps"
          : "© OpenStreetMap • OpenFreeMap • Overture Maps",
      );

      const style = useProtomaps
        ? buildProtomapsStyle(window.location.origin)
        : buildOpenFreeMapStyle();

      if (!maplibregl.getWorkerUrl()) {
        maplibregl.setWorkerUrl(
          new URL(
            "maplibre-gl/dist/maplibre-gl-worker.mjs",
            import.meta.url,
          ).toString(),
        );
      }

      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: initialCenter,
        zoom: initialZoom,
        maxZoom: 19,
        attributionControl: false,
      });

      map.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        "top-right",
      );

      const targetMarker = new maplibregl.Marker({
        element: createTargetElement(),
        draggable: true,
        anchor: "center",
      })
        .setLngLat(initialCenter)
        .addTo(map);

      targetMarker.on("dragend", () => {
        const pos = targetMarker.getLngLat();
        onChangeRef.current?.({
          latitude: Number(pos.lat.toFixed(6)),
          longitude: Number(pos.lng.toFixed(6)),
        });
      });

      map.on("load", () => {
        styleReady = true;
        ensurePlacesOverlay(map, geojsonRef.current);
        fetchViewportPlaces(map);
      });

      map.on("style.load", () => {
        styleReady = true;
        ensurePlacesOverlay(map, geojsonRef.current);
      });

      map.on("error", (event) => {
        const status = event?.error?.status;
        if (
          useProtomaps &&
          !fallbackSwitchedRef.current &&
          typeof status === "number" &&
          status >= 500
        ) {
          fallbackSwitchedRef.current = true;
          styleReady = false;
          setCreditText("© OpenStreetMap • OpenFreeMap • Overture Maps");
          map.setStyle(buildOpenFreeMapStyle());
        }
      });

      map.on("moveend", () => {
        scheduleViewportFetch(map);
      });

      for (const layerId of ["db-places-layer", "db-places-labels"]) {
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      map.on("click", (event) => {
        const activeLayers = ["db-places-layer", "db-places-labels"].filter(
          (layerId) => Boolean(map.getLayer(layerId)),
        );
        const hits = activeLayers.length
          ? map.queryRenderedFeatures(event.point, {
              layers: activeLayers,
            })
          : [];

        if (hits.length > 0) {
          const feature = hits[0];
          const [lng, lat] = feature.geometry.coordinates;
          popupRef.current?.remove();
          popupRef.current = new maplibregl.Popup({
            closeButton: true,
            offset: 12,
          })
            .setLngLat([lng, lat])
            .setDOMContent(createPopupContent(feature.properties))
            .addTo(map);
          return;
        }

        popupRef.current?.remove();
        targetMarker.setLngLat(event.lngLat);
        onChangeRef.current?.({
          latitude: Number(event.lngLat.lat.toFixed(6)),
          longitude: Number(event.lngLat.lng.toFixed(6)),
        });
      });

      mapRef.current = map;
      markerRef.current = targetMarker;
    }

    initMap();

    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
      abortRef.current?.abort();
      popupRef.current?.remove();
      refMarkerRef.current?.remove();
      markerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
      markerRef.current = null;
      refMarkerRef.current = null;
      popupRef.current = null;
    };
    // Inicialização única do mapa; coordenadas e referência sincronizam nos efeitos abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!markerRef.current || !hasCoords) return;
    markerRef.current.setLngLat([lonNum, latNum]);
  }, [hasCoords, latNum, lonNum]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    refMarkerRef.current?.remove();
    refMarkerRef.current = null;

    const rLat = Number(referencia?.latitude);
    const rLon = Number(referencia?.longitude);
    if (Number.isFinite(rLat) && Number.isFinite(rLon)) {
      refMarkerRef.current = new maplibregl.Marker({
        element: createReferenceElement(referencia?.label),
        draggable: false,
        anchor: "center",
      })
        .setLngLat([rLon, rLat])
        .addTo(map);
    }
  }, [referencia]);

  function centralizar() {
    if (!mapRef.current || !hasCoords) return;
    mapRef.current.flyTo({ center: [lonNum, latNum], zoom: 17, duration: 350 });
  }

  return (
    <div className="adm-map-wrap">
      <div className="adm-map-frame">
        <div
          ref={containerRef}
          className="adm-map-box"
          aria-label="Mapa para ajustar coordenadas do estabelecimento"
        />
        <span className="adm-map-credit">{creditText}</span>
      </div>
      <div className="adm-map-status">
        <div className="adm-map-legend">
          <span className="adm-map-key">
            <span className="adm-map-swatch is-menu" aria-hidden="true" />
            Com cardápio
          </span>
          <span className="adm-map-key">
            <span className="adm-map-swatch is-empty" aria-hidden="true" />
            Sem cardápio
          </span>
          <span className="adm-map-key">
            <span className="adm-map-swatch is-hidden" aria-hidden="true" />
            Excluído
          </span>
        </div>
        <span className="adm-tnum">
          {zoomWarning
            ? "Aproxime (zoom ≥ 14) para ver locais do banco"
            : `${dbCount} local(is) nesta área`}
        </span>
      </div>
      <div className="adm-row-between" style={{ marginTop: 6 }}>
        <span className="adm-muted">
          Clique no mapa ou arraste o círculo azul para ajustar a posição.
        </span>
        {hasCoords ? (
          <button
            type="button"
            onClick={centralizar}
            className="adm-btn adm-btn-secondary adm-btn-sm"
          >
            Centralizar pino
          </button>
        ) : null}
      </div>
    </div>
  );
}
