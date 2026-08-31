export async function getServerSideProps({ res }) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(
    JSON.stringify({
      status: "/api/v1/status",
    }),
  );

  return { props: {} };
}

export default function StatusPage() {
  return null;
}
