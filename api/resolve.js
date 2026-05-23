// api/resolve.js
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed; use POST' });
  }

  const WORKER_URL = process.env.WORKER_URL;
  const WORKER_KEY = process.env.WORKER_KEY;

  if (!WORKER_URL) {
    return res.status(500).json({ ok: false, error: 'Not configured' });
  }

  // Parse + re-serialize body
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};

  try {
    const response = await fetch(`${WORKER_URL}/api/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WORKER_KEY ? { 'X-Worker-Key': WORKER_KEY } : {}),
      },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
}
