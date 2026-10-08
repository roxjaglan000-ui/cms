import { createServer } from 'node:net';
import { Aedes } from 'aedes';
import { config } from './config.js';
import { provisionDevice, findPanelByToken, ingest, logEvent } from './service.js';

// MQTT device API, ThingsBoard jaisa hi, taaki panel firmware me sirf MQTT_HOST badalna pade:
//   username "provision"  -> publish /provision/request, reply on /provision/response
//   username <token>      -> publish v1/devices/me/telemetry
//                            receive v1/devices/me/rpc/request/<id>, reply v1/devices/me/rpc/response/<id>
// Server har panel ko seedha uske connection pe message bhejta hai; ek panel dusre ka data kabhi nahi dekhta.

const TELEMETRY = 'v1/devices/me/telemetry';
const RPC_REQ = 'v1/devices/me/rpc/request/';
const RPC_RES = 'v1/devices/me/rpc/response/';

export async function startBroker(log = console) {
  const clientsByPanel = new Map();   // panelId -> aedes client
  const pendingRpc = new Map();       // reqId -> { panelId, resolve, reject, timer }
  let nextReqId = 1;
  const ingestQueue = new Map();      // panelId -> last ingest promise

  const aedes = await Aedes.createBroker({ maxClientsIdLength: 64, drainTimeout: 30000 });

  aedes.authenticate = (client, username, password, done) => {
    if (username === 'provision') {
      client.cms = { provision: true };
      return done(null, true);
    }
    findPanelByToken(username).then((panel) => {
      if (!panel) {
        const err = new Error('Bad token');
        err.returnCode = 5;   // firmware isse token bhool ke dobara provision karta hai
        return done(err, false);
      }
      client.cms = { panelId: panel.id };
      done(null, true);
    }, (err) => done(err, false));
  };

  aedes.authorizeSubscribe = (client, sub, done) => {
    const ok = client.cms?.provision ? sub.topic === '/provision/response'
      : sub.topic === `${RPC_REQ}+` || sub.topic.startsWith('v1/devices/me/attributes');
    done(null, ok ? sub : null);
  };

  aedes.authorizePublish = (client, packet, done) => {
    const t = packet.topic;
    const ok = client?.cms?.provision ? t === '/provision/request'
      : t === TELEMETRY || t.startsWith(RPC_RES);
    done(ok ? null : new Error(`Topic not allowed: ${t}`));
  };

  // Broker routing band: panels ko sirf server ke direct messages milte hain (deliver() se)
  // (aedes packet me sirf clientId jaisi kuch fields bachti hain, isliye target usi me rakha hai)
  const target = (client) => `$cms:${client.id}`;
  aedes.authorizeForward = (client, packet) => (packet.clientId === target(client) ? packet : null);

  function deliver(client, topic, body) {
    client.publish({ topic, payload: Buffer.from(JSON.stringify(body)), qos: 0, retain: false,
      clientId: target(client) }, (err) => err && log.warn?.(`deliver to ${client.id}: ${err.message}`));
  }

  aedes.on('clientReady', (client) => {
    const id = client.cms?.panelId;
    if (!id) return;
    const old = clientsByPanel.get(id);
    clientsByPanel.set(id, client);
    if (old && old !== client) old.close();
  });
  aedes.on('clientDisconnect', (client) => {
    const id = client.cms?.panelId;
    if (id && clientsByPanel.get(id) === client) clientsByPanel.delete(id);
  });

  aedes.on('publish', (packet, client) => {
    if (!client?.cms) return;
    let body;
    try { body = JSON.parse(packet.payload.toString()); } catch { return; }

    if (client.cms.provision) {
      provisionDevice(body).then((res) => deliver(client, '/provision/response', res),
        (err) => log.error?.('provision failed', err));
      return;
    }
    const panelId = client.cms.panelId;
    if (packet.topic === TELEMETRY) {
      // Ek panel ke messages ek ke baad ek (event aur snapshot ka order bana rahe)
      const prev = ingestQueue.get(panelId) || Promise.resolve();
      const next = prev.then(() => ingest(panelId, body))
        .catch((err) => log.error?.(`ingest panel ${panelId}`, err));
      ingestQueue.set(panelId, next);
      next.then(() => { if (ingestQueue.get(panelId) === next) ingestQueue.delete(panelId); });
    } else if (packet.topic.startsWith(RPC_RES)) {
      const reqId = packet.topic.slice(RPC_RES.length);
      const p = pendingRpc.get(reqId);
      if (p && p.panelId === panelId) {
        clearTimeout(p.timer);
        pendingRpc.delete(reqId);
        p.resolve(body);
      }
    }
  });

  // Dashboard se panel ko command (setLight, setMode, setSchedule, getStatus, ...)
  async function rpc(panelId, method, params, username) {
    const client = clientsByPanel.get(panelId);
    if (!client) {
      const err = new Error('Panel is not connected right now');
      err.status = 409;
      throw err;
    }
    const reqId = String(nextReqId++);
    await logEvent(panelId, 'command', `${method} ${params === undefined ? '' : JSON.stringify(params)}`.trim(), username);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRpc.delete(reqId);
        const err = new Error('Panel did not reply in time');
        err.status = 504;
        reject(err);
      }, config.rpcTimeoutMs);
      pendingRpc.set(reqId, { panelId, resolve, reject, timer });
      deliver(client, RPC_REQ + reqId, { method, params });
    });
  }

  const server = createServer(aedes.handle);
  await new Promise((resolve) => server.listen(config.mqttPort, resolve));
  log.info?.(`MQTT listening on ${config.mqttPort}`);

  return {
    rpc,
    isConnected: (panelId) => clientsByPanel.has(panelId),
    connectedCount: () => clientsByPanel.size,
    port: () => server.address().port,
    close: () => new Promise((resolve) => {
      for (const p of pendingRpc.values()) clearTimeout(p.timer);
      aedes.close(() => server.close(() => resolve()));
    }),
  };
}
