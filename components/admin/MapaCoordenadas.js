import L from "leaflet";
import { useEffect, useRef } from "react";

const CENTRO_PADRAO = [-23.55052, -46.633308];

function criarIconePino(corPrincipal) {
  return L.divIcon({
    className: "",
    iconSize: [28, 36],
    iconAnchor: [14, 34],
    html: `<svg width="28" height="36" viewBox="0 0 28 36" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M14 1C6.82 1 1 6.82 1 14c0 9.75 13 21 13 21s13-11.25 13-21C27 6.82 21.18 1 14 1Z" fill="${corPrincipal}" stroke="#0E1D26" stroke-width="2"/><circle cx="14" cy="14" r="5" fill="#FFFFFF"/></svg>`,
  });
}

// Mapa interativo para conferir e ajustar a posição do estabelecimento.
// Carregado somente no cliente via `next/dynamic(..., { ssr: false })`.
export default function MapaCoordenadas({
  latitude,
  longitude,
  referencia = null,
  onChange,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const refMarkerRef = useRef(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const latNum = Number(latitude);
  const lonNum = Number(longitude);
  const hasCoords = Number.isFinite(latNum) && Number.isFinite(lonNum);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter = hasCoords ? [latNum, lonNum] : CENTRO_PADRAO;
    const map = L.map(containerRef.current, {
      center: initialCenter,
      zoom: hasCoords ? 17 : 12,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap",
    }).addTo(map);

    const marker = L.marker(initialCenter, {
      draggable: true,
      icon: criarIconePino("#27C4F4"),
    }).addTo(map);

    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      onChangeRef.current?.({
        latitude: Number(pos.lat.toFixed(6)),
        longitude: Number(pos.lng.toFixed(6)),
      });
    });

    map.on("click", (event) => {
      const { lat, lng } = event.latlng;
      marker.setLatLng([lat, lng]);
      onChangeRef.current?.({
        latitude: Number(lat.toFixed(6)),
        longitude: Number(lng.toFixed(6)),
      });
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      refMarkerRef.current = null;
    };
    // Inicialização única do mapa; coordenadas são sincronizadas no efeito abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!mapRef.current || !markerRef.current || !hasCoords) return;
    markerRef.current.setLatLng([latNum, lonNum]);
  }, [hasCoords, latNum, lonNum]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (refMarkerRef.current) {
      refMarkerRef.current.remove();
      refMarkerRef.current = null;
    }

    const rLat = Number(referencia?.latitude);
    const rLon = Number(referencia?.longitude);
    if (Number.isFinite(rLat) && Number.isFinite(rLon)) {
      refMarkerRef.current = L.marker([rLat, rLon], {
        draggable: false,
        icon: criarIconePino("#A8620E"),
        title: referencia?.label || "Referência enviada pelo usuário",
      }).addTo(map);
    }
  }, [referencia]);

  function centralizar() {
    if (!mapRef.current || !hasCoords) return;
    mapRef.current.setView([latNum, lonNum], 17);
  }

  return (
    <div>
      <div
        ref={containerRef}
        className="adm-map-box"
        aria-label="Mapa para ajustar coordenadas do estabelecimento"
      />
      <div className="adm-row-between" style={{ marginTop: 8 }}>
        <span className="adm-muted">
          Clique no mapa ou arraste o marcador azul para ajustar a posição.
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
