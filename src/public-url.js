const { lookup } = require("node:dns/promises");
const { BlockList, isIP } = require("node:net");

const blocked = new BlockList();
for (const [ip, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["192.0.0.0", 24], ["198.18.0.0", 15], ["224.0.0.0", 3]]) blocked.addSubnet(ip, prefix, "ipv4");
for (const [ip, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]]) blocked.addSubnet(ip, prefix, "ipv6");

function isPublicAddress(address) {
  const family = isIP(address);
  return !!family && !blocked.check(address, family === 4 ? "ipv4" : "ipv6");
}

async function validatePublicUrl(value, lookupImpl = lookup) {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("URL tidak valid");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookupImpl(host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("Resolver hanya menerima URL internet publik");
}

function publicLookup(host, options, callback) {
  const opts = typeof options === "object" ? options : { family: options };
  lookup(host, { ...opts, all: true }).then((addresses) => {
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new Error("Alamat resolver bukan IP publik");
    if (opts.all) callback(null, addresses);
    else callback(null, addresses[0].address, addresses[0].family);
  }).catch((error) => callback(error));
}

module.exports = { validatePublicUrl, isPublicAddress, publicLookup };
