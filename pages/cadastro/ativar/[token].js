import AbrirNoAplicativo from "components/AbrirNoAplicativo.js";

// O endereço do link de ativação é uma página, e não uma rota da API, porque
// ele é aberto por gente, e não por programa. Mas quem ATIVA a conta é o
// aplicativo, e esta página nunca chama `PATCH /api/v1/activations` — o
// porquê está em `components/AbrirNoAplicativo.js`.
export default function AtivarNoAplicativo() {
  return (
    <AbrirNoAplicativo
      aba="Ativar conta"
      titulo="Ative sua conta no aplicativo"
      texto="Este link ativa sua conta dentro do Menu Spoiler. Abra-o no celular em que o aplicativo está instalado."
    />
  );
}
