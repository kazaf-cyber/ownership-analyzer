export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const WORKER_URL = process.env.WORKER_URL;
  const WORKER_KEY = process.env.WORKER_KEY;

  if (!WORKER_URL) {
    return res.status(500).json({ error: 'Worker not configured' });
  }

  try {
    const response = await fetch(`${WORKER_URL}/api/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(WORKER_KEY ? { 'X-Worker-Key': WORKER_KEY } : {}),
      },
      body: JSON.stringify(req.body),
    });

    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (err) {
    return res.status(502).json({ error: 'Proxy error: ' + err.message });
  }
}

