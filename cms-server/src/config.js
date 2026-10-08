// Saari settings environment variables se aati hain (.env.example dekho).
const env = process.env;

function required(name, fallback) {
  const v = env[name] ?? fallback;
  if (v === undefined || v === '') throw new Error(`Missing env ${name}`);
  return v;
}

export const config = {
  databaseUrl: required('DATABASE_URL', 'postgres://cms:cms@localhost:5432/cms'),
  httpPort: Number(env.HTTP_PORT || 8080),
  mqttPort: Number(env.MQTT_PORT || 1883),
  jwtSecret: required('JWT_SECRET', env.NODE_ENV === 'production' ? undefined : 'dev-only-secret'),
  adminUser: env.ADMIN_USER || 'admin',
  adminPassword: required('ADMIN_PASSWORD', env.NODE_ENV === 'production' ? undefined : 'admin123'),
  // Firmware me PROVISION_KEY / PROVISION_SECRET same hone chahiye
  provisionKey: env.PROVISION_KEY || 'cms-provision-key',
  provisionSecret: env.PROVISION_SECRET || 'cms-provision-secret',
  // Itne minute data na aaye to panel OFFLINE (firmware default 5 min bhejta hai)
  offlineAfterMin: Number(env.OFFLINE_AFTER_MIN || 15),
  rpcTimeoutMs: Number(env.RPC_TIMEOUT_MS || 30000),
  timezone: env.CMS_TIMEZONE || 'Asia/Kolkata',
};
