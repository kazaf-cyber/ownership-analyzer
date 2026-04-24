export default async function handler(req, res) {
  const WORKER_URL = process.env.WORKER_URL;
  const WORKER_KEY = process.env.WORKER_KEY;

  if (!WORKER_URL) {
    return res.status(500).json({ ok: false, error: 'Not configured' });
  }

  try {
    const response = await fetch(`${WORKER_URL}/api/health`, {
      headers: {
        ...(WORKER_KEY ? { 'X-Worker-Key': WORKER_KEY } : {}),
      },
    });
    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
}

