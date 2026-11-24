export async function getServerSideProps() {
  return {
    redirect: {
      destination: "/admin#conta",
      permanent: false,
    },
  };
}

export default function AdminContaRedirect() {
  return null;
}
