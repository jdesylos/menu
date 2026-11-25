export async function getServerSideProps() {
  return {
    redirect: {
      destination: "/admin#usuarios",
      permanent: false,
    },
  };
}

export default function AdminUsuariosRedirect() {
  return null;
}
