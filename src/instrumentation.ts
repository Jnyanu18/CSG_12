export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Local router DNS doesn't support MongoDB Atlas SRV record lookups.
    // This runs once at server startup in the real Node.js process before
    // any mongoose connection is attempted.
    const dns = await import('dns');
    dns.setServers(['8.8.8.8', '8.8.4.4']);
  }
}
