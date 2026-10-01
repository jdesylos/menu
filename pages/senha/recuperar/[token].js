import AbrirNoAplicativo from "components/AbrirNoAplicativo.js";

// O endereço do link de "esqueci a senha". Quem escolhe a senha nova é o
// aplicativo, e esta página nunca chama `PATCH /api/v1/recoveries` — o porquê
// está em `components/AbrirNoAplicativo.js`.
export default function RecuperarNoAplicativo() {
  return (
    <AbrirNoAplicativo
      aba="Nova senha"
      titulo="Crie sua senha nova no aplicativo"
      texto="Este link abre a troca de senha dentro do Menu Spoiler. Abra-o no celular em que o aplicativo está instalado."
    />
  );
}
