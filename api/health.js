// api/health.js — self-contained, no worker proxy
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') return res.status(204).end();
  
  return res.status(200).json({
    ok: true,
    service: 'kyc-screening-backend',
    runtime: 'vercel-serverless',
    region: process.env.VERCEL_REGION || 'unknown',
    timestamp: new Date().toISOString(),
  });
}
