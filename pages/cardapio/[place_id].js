import AbrirNoAplicativo from "components/AbrirNoAplicativo.js";
import { NotFoundError } from "infra/errors.js";
import place from "models/place.js";

// Link compartilhado de um cardápio (`https://menuspoiler.com.br/cardapio/<id>`).
//
// No celular com o aplicativo instalado, o sistema abre direto no lugar certo.
// Na web, mostra apenas o nome do estabelecimento (sem exibir pratos ou preços)
// e oferece os atalhos para baixar ou abrir no aplicativo.
export async function getServerSideProps({ params, res }) {
  const placeId = params?.place_id;

  try {
    const found = await place.findOneById(placeId);

    if (found.hidden_at !== null) {
      return notFoundFallback(res);
    }

    res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    res.setHeader(
      "Vercel-CDN-Cache-Control",
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );
    res.setHeader("Vercel-Cache-Tag", place.shareCacheTag(found.id));

    return {
      props: {
        place: {
          id: found.id,
          name: found.name,
        },
      },
    };
  } catch (error) {
    if (error instanceof NotFoundError) {
      return notFoundFallback(res);
    }
    throw error;
  }
}

function notFoundFallback(res) {
  res.statusCode = 404;
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, max-age=0, must-revalidate",
  );
  return {
    props: {
      place: null,
    },
  };
}

export default function CardapioCompartilhado({ place: found }) {
  if (!found) {
    return (
      <AbrirNoAplicativo
        aba="Cardápio não encontrado"
        titulo="Este lugar não está mais disponível"
        descricao="Consulte cardápios e preços dos lugares perto de você no aplicativo Menu Spoiler."
        texto="Não encontramos o lugar deste link, mas você pode explorar outros cardápios perto de você no aplicativo Menu Spoiler."
        mostrarLojas
        podeAbrirNoApp={false}
        semReferrer={false}
      />
    );
  }

  return (
    <AbrirNoAplicativo
      aba={found.name}
      titulo={found.name}
      descricao={`Veja o cardápio e os preços de ${found.name} no aplicativo Menu Spoiler.`}
      texto={`Abra o aplicativo Menu Spoiler para conferir os pratos e os preços de ${found.name}.`}
      mostrarLojas
      podeAbrirNoApp
      semReferrer={false}
    />
  );
}
