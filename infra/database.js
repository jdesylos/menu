import { AsyncLocalStorage } from "node:async_hooks";
import { Client } from "pg";
import { ServiceError } from "./errors.js";

// A conexão que uma requisição divide entre as consultas dela — ver
// `withSharedClient`. Fora de uma requisição não há nada guardado aqui.
const sharedClientScope = new AsyncLocalStorage();

async function query(queryObject) {
  const scope = sharedClientScope.getStore();
  if (scope && !scope.closed) {
    return await queryWithSharedClient(scope, queryObject);
  }

  let client;
  try {
    client = await getNewClient();
    const result = await client.query(queryObject);
    return result;
  } catch (error) {
    const serviceErrorObject = new ServiceError({
      message: "Erro na conexão com Banco ou na Query.",
      cause: error,
    });
    throw serviceErrorObject;
  } finally {
    await client?.end();
  }
}

// Roda `callback` com UMA conexão para todas as consultas que ele fizer, e a
// fecha quando ele termina. Quem chama é o `controller`, uma vez por
// requisição.
//
// Sem isto cada `query` abre a própria conexão — TCP, TLS e autenticação — e
// a fecha em seguida. Medido em produção, são cerca de 0,2 s por consulta, e
// mandar um cardápio faz cinco em sequência: a sessão, a conta, o lugar, a
// gravação e a leitura do que gravou. Um segundo inteiro de espera no botão
// "Confirmar" só abrindo e fechando conexão.
//
// Não é um pool, de propósito. Um pool guarda a conexão ENTRE requisições, e
// numa função serverless isso é guardar uma conexão aberta numa instância
// congelada: ou ela ocupa uma vaga no banco sem ninguém usando, ou o banco a
// fecha e a requisição seguinte descobre isso no meio de uma consulta. Aqui a
// conexão nasce na primeira consulta da requisição e morre com ela — o que
// também mantém verdadeiro o que o `/status` mede: uma conexão aberta por vez.
//
// A conexão só é aberta se houver consulta: a rota que responde sem ir ao
// banco não paga por ela.
async function withSharedClient(callback) {
  // Já dentro de uma requisição, a conexão é a dela.
  if (sharedClientScope.getStore()) {
    return await callback();
  }

  const scope = { client: null, closed: false };
  try {
    return await sharedClientScope.run(scope, callback);
  } finally {
    await closeSharedClient(scope);
  }
}

async function queryWithSharedClient(scope, queryObject) {
  try {
    const client = await getSharedClient(scope);
    const result = await client.query(queryObject);
    return result;
  } catch (error) {
    const serviceErrorObject = new ServiceError({
      message: "Erro na conexão com Banco ou na Query.",
      cause: error,
    });
    throw serviceErrorObject;
  }
}

// A conexão da requisição: a que já existe, ou uma aberta agora.
//
// O que fica guardado é a PROMESSA da conexão, e não a conexão: duas
// consultas disparadas juntas esperam a mesma abertura, em vez de abrir uma
// cada.
function getSharedClient(scope) {
  if (scope.client) {
    return scope.client;
  }

  const connecting = getNewClient().then((client) => {
    // Conexão que caiu não serve à consulta seguinte, que abre outra — como
    // acontecia quando cada consulta abria a sua. E o ouvinte de "error" não
    // é enfeite: uma conexão PARADA que cai emite o erro como evento, e
    // evento de erro sem ouvinte derruba o processo.
    client.on("error", forget);
    client.on("end", forget);
    return client;
  });

  // A que nem chegou a abrir também não fica guardada.
  connecting.catch(forget);

  function forget() {
    if (scope.client === connecting) {
      scope.client = null;
    }
  }

  scope.client = connecting;
  return connecting;
}

// Fecha a conexão da requisição, se ela chegou a abrir uma.
//
// Marca o escopo como fechado antes: uma consulta que a rota tenha deixado
// para trás, sem esperar, ainda enxerga este escopo — e sem a marca abriria
// uma conexão nele que ninguém mais fecharia. Com a marca ela cai no caminho
// de sempre, que abre e fecha a própria.
async function closeSharedClient(scope) {
  const connecting = scope.client;
  scope.client = null;
  scope.closed = true;

  if (!connecting) {
    return;
  }

  try {
    const client = await connecting;
    await client.end();
  } catch {
    // A resposta já foi dada, e uma conexão que não abriu ou que já caiu não
    // tem o que fechar.
  }
}

async function getNewClient() {
  const client = new Client({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    user: process.env.POSTGRES_USER,
    database: process.env.POSTGRES_DB,
    password: process.env.POSTGRES_PASSWORD,
    ssl: getSSLValues(),
  });

  await client.connect();
  return client;
}

const database = {
  query,
  getNewClient,
  withSharedClient,
};

export default database;

function getSSLValues() {
  if (process.env.POSTGRES_CA) {
    return {
      ca: process.env.POSTGRES_CA,
    };
  }

  return process.env.NODE_ENV === "production" ? true : false;
}
