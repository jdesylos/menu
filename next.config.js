// O arquivo dos Universal Links do iOS não tem extensão — o nome é o que a
// Apple procura no domínio —, e arquivo sem extensão sai da pasta `public`
// como `application/octet-stream`. A Apple pede `application/json`.
module.exports = {
  async headers() {
    return [
      {
        source: "/.well-known/apple-app-site-association",
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    ];
  },
};
