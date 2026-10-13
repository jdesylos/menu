import { dangerouslyDeleteByTag, waitUntil } from "@vercel/functions";

// O que a borda da Vercel guarda das nossas respostas, e como tirar de lá
// antes do prazo.
//
// As rotas do mapa respondem com `s-maxage`, e a borda repete a resposta sem
// chamar a função até o prazo vencer. Quando o dado muda antes disso, quem
// sabe que mudou avisa por aqui. Só sai o que foi guardado com etiqueta: o
// cabeçalho `Vercel-Cache-Tag`, que a rota escreve.
//
// Fora da Vercel — desenvolvimento, testes, scripts — não existe borda, e as
// duas chamadas do pacote não fazem nada.

// Apaga da borda as respostas guardadas com estas etiquetas: o próximo pedido
// de cada uma delas vai à função.
//
// APAGAR, e não invalidar (`invalidateByTag`): a invalidação entrega a cópia
// velha mais uma vez e renova por trás. Num tile que quase ninguém pede, essa
// vez é a de quem acabou de mudar o dado.
//
// Não é esperada por quem chama, e nunca falha para ele: a resposta da
// requisição sai sem esperar a borda, e o `waitUntil` mantém a função viva até
// a purga terminar. Se ela falhar, a cópia velha fica até o prazo dela — é o
// que acontecia antes de isto existir —, e o que se guardou no banco não
// volta atrás por isso.
function forget(tags) {
  waitUntil(deleteByTags(tags));
}

async function deleteByTags(tags) {
  try {
    await dangerouslyDeleteByTag(tags);
  } catch (error) {
    console.error({
      name: "CdnPurgeError",
      tags,
      underlyingErrorName: error?.name,
    });
  }
}

const cdn = {
  forget,
};

export default cdn;
