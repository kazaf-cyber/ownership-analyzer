/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    const workerUrl = process.env.WORKER_URL;
    
    if (!workerUrl) {
      console.warn('⚠️  WORKER_URL is not set! Rewrites disabled.');
      return [];
    }
    
    console.log(`✅ Rewrites configured for: ${workerUrl}`);
    
    return [
      {
        source: '/api/scrape',
        destination: `${workerUrl}/api/scrape`,
      },
      {
        source: '/api/batch-scrape',
        destination: `${workerUrl}/api/batch-scrape`,
      },
      {
        source: '/api/resolve',
        destination: `${workerUrl}/api/resolve`,
      },
      {
        source: '/api/worker-health',
        destination: `${workerUrl}/api/health`,
      },
    ];
  },
};

module.exports = nextConfig;
