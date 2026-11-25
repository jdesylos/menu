export async function getServerSideProps(context) {
  const params = new URLSearchParams();
  if (typeof context.query.q === "string" && context.query.q) {
    params.set("q", context.query.q);
  }
  if (
    typeof context.query.visibility === "string" &&
    context.query.visibility
  ) {
    params.set("visibility", context.query.visibility);
  }
  if (typeof context.query.has_menu === "string" && context.query.has_menu) {
    params.set("has_menu", context.query.has_menu);
  }
  const hash = context.query.tab === "sugestoes" ? "#sugestoes" : "";
  const query = params.toString();

  return {
    redirect: {
      destination: `/admin${query ? `?${query}` : ""}${hash}`,
      permanent: false,
    },
  };
}

export default function AdminEstabelecimentosRedirect() {
  return null;
}
