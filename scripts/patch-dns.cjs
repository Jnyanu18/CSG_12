/**
 * DNS patch — loaded via node --require before Next.js starts.
 * The local router DNS refuses SRV record queries (type=33) needed by
 * mongodb+srv:// URI resolution. We replace dns.resolveSrv and
 * dns.resolveTxt with versions that use a dedicated Resolver pointed at
 * Google Public DNS, which handles all record types correctly.
 */
const dns = require('dns');
const { Resolver } = require('dns/promises');

const resolver = new Resolver();
resolver.setServers(['8.8.8.8', '8.8.4.4']);

// Callback API (used by older mongodb driver internals)
dns.resolveSrv = (hostname, callback) => {
  resolver.resolveSrv(hostname).then(r => callback(null, r)).catch(e => callback(e));
};
dns.resolveTxt = (hostname, callback) => {
  resolver.resolveTxt(hostname).then(r => callback(null, r)).catch(e => callback(e));
};

// Promises API (used by mongodb driver v5+)
dns.promises.resolveSrv = (hostname) => resolver.resolveSrv(hostname);
dns.promises.resolveTxt = (hostname) => resolver.resolveTxt(hostname);

console.log('[dns-patch] SRV/TXT lookups routed to Google DNS (8.8.8.8)');
