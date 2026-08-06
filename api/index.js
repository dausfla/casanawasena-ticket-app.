import app, { ensureDbInit } from '../server.js';

export default async function handler(req, res) {
  await ensureDbInit();
  return app(req, res);
}
