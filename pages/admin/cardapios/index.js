export async function getServerSideProps() {
  return {
    redirect: {
      destination: "/admin?has_menu=true",
      permanent: false,
    },
  };
}

export default function AdminCardapiosRedirect() {
  return null;
}
