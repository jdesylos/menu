import Link from "next/link";
import PaginaDeTexto from "components/PaginaDeTexto.js";

// Como apagar a conta, num endereço público: a Play pede um, para quem não tem
// mais o aplicativo instalado. Quem apaga é o aplicativo (`DELETE
// /api/v1/user`); esta página só explica, e oferece o email para quem não
// consegue entrar nele.
//
// O que some e o que fica é o que `models/user.js` faz em `erase()` — mudou
// lá, muda aqui.

const EMAIL = "contato@menuspoiler.com.br";

export default function ApagarConta() {
  return (
    <PaginaDeTexto
      aba="Apagar a conta"
      descricao="Como apagar sua conta do Menu Spoiler, o que é apagado e o que continua."
      titulo="Como apagar sua conta"
    >
      <p>
        Você pode apagar sua conta do Menu Spoiler a qualquer momento, pelo
        próprio aplicativo. O Menu Spoiler é da JBS DESIGN E MARKETING LTDA.
      </p>

      <h2>Pelo aplicativo</h2>
      <ol>
        <li>Abra o Menu Spoiler e entre na sua conta.</li>
        <li>Na tela do mapa, toque no seu nome, embaixo.</li>
        <li>
          Toque em “Apagar conta” e, na pergunta “Apagar a conta?”, em “Apagar
          conta” de novo.
        </li>
      </ol>
      <p>A conta é apagada na hora, e não dá para desfazer.</p>

      <h2>Sem o aplicativo</h2>
      <p>
        Se você não tem mais o aplicativo, mande um email para{" "}
        <a href={`mailto:${EMAIL}`}>{EMAIL}</a> do mesmo endereço da sua conta,
        pedindo para apagá-la. Respondemos pelo mesmo email quando ela for
        apagada.
      </p>

      <h2>O que é apagado</h2>
      <ul>
        <li>O nome de usuário, o email e a senha.</li>
        <li>As sessões, em todos os aparelhos em que você entrou.</li>
        <li>
          Os links de ativação e de troca de senha que ainda estavam abertos.
        </li>
        <li>O endereço IP guardado nos registros das ações da sua conta.</li>
      </ul>

      <h2>O que continua</h2>
      <ul>
        <li>
          Os cardápios e as sugestões que você enviou. Eles continuam no
          aplicativo, mostrados a todos, sem o seu nome e sem ligação com você:
          o cardápio é do lugar, e não de quem o enviou. Se quiser que um
          cardápio seu saia do aplicativo, peça pelo email antes de apagar a
          conta — depois, não temos mais como saber quais eram os seus.
        </li>
        <li>
          O registro do que aconteceu na conta (como a data em que ela foi
          criada e apagada), sem nenhum dado que identifique você.
        </li>
        <li>
          Os registros técnicos do servidor, pelo prazo padrão do provedor de
          hospedagem.
        </li>
      </ul>

      <p>
        Os detalhes estão nos{" "}
        <Link href="/privacidade">termos de uso e política de privacidade</Link>
        .
      </p>
    </PaginaDeTexto>
  );
}
