export async function getServerSideProps({ res }) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      name: "Menu Spoiler",
      description: "API REST do Menu Spoiler.",
      status: "/api/v1/status",
    }),
  );

  return { props: {} };
}

export default function Home() {
  return null;
}
