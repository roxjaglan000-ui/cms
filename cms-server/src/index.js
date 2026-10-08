import { migrate, pool } from './db.js';
import { startBroker } from './broker.js';
import { startHttp } from './http.js';
import { sweepOffline } from './service.js';

export async function start(log = console) {
  await migrate(log);
  const broker = await startBroker(log);
  const http = await startHttp(broker, log);
  const timer = setInterval(() => sweepOffline().catch((err) => log.error?.('offline sweep', err)), 60000);
  return {
    broker,
    http,
    async stop() {
      clearInterval(timer);
      await http.close();
      await broker.close();
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await start();
  const shutdown = async () => {
    await app.stop();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
