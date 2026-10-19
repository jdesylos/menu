import PaginaDeTexto from "components/PaginaDeTexto.js";
import termos from "models/termos.js";

// Os termos de uso e a política de privacidade, num endereço público — é o
// que as lojas pedem, e o mesmo texto que a pessoa aceita no cadastro do
// aplicativo (ver `models/termos.js`).

export async function getStaticProps() {
  return { props: { blocos: termos.ler() } };
}

// Os itens seguidos viram uma lista só.
function agrupar(blocos) {
  const grupos = [];
  for (const bloco of blocos) {
    const anterior = grupos[grupos.length - 1];
    if (bloco.tipo === "item" && anterior?.tipo === "lista") {
      anterior.itens.push(bloco.texto);
    } else if (bloco.tipo === "item") {
      grupos.push({ tipo: "lista", itens: [bloco.texto] });
    } else {
      grupos.push(bloco);
    }
  }
  return grupos;
}

export default function Privacidade({ blocos }) {
  return (
    <PaginaDeTexto
      aba="Termos e privacidade"
      descricao="Os termos de uso e a política de privacidade do aplicativo Menu Spoiler: o que coletamos, para que usamos, com quem compartilhamos e como apagar a conta."
      titulo="Termos de uso e política de privacidade"
    >
      {agrupar(blocos).map((grupo, indice) => {
        if (grupo.tipo === "titulo") {
          return <h2 key={indice}>{grupo.texto}</h2>;
        }
        if (grupo.tipo === "lista") {
          return (
            <ul key={indice}>
              {grupo.itens.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          );
        }
        return <p key={indice}>{grupo.texto}</p>;
      })}
    </PaginaDeTexto>
  );
}
