import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, networkInterfaces } from 'node:os';
import { isIP } from 'node:net';
import { resolve } from 'node:path';
import { isLocalNetworkAddress } from './lan-server.mjs';

export function lanAddresses(interfaces = networkInterfaces()) {
  return [...new Set(Object.entries(interfaces).sort(([a], [b]) => a.localeCompare(b)).flatMap(([, items]) =>
    (items ?? []).filter(item => item.family === 'IPv4' && !item.internal && isLocalNetworkAddress(item.address)).map(item => item.address)))];
}
export function lanNames() {
  const name = hostname().toLowerCase();
  return [...new Set(['localhost', name, name.endsWith('.local') ? name : `${name}.local`])]
    .filter(value => /^[a-z0-9][a-z0-9.-]*$/.test(value));
}

/** Make a dedicated CA and server certificate, without changing any OS/browser trust settings. */
export function ensureLanCertificate(directory, hosts) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const ca = resolve(directory, 'nyamuru-lan-ca.crt');
  const caKey = resolve(directory, 'nyamuru-lan-ca.key');
  const cert = resolve(directory, 'server.crt');
  const key = resolve(directory, 'server.key');
  const run = args => execFileSync('openssl', args, { cwd: directory, stdio: 'pipe' });
  if (existsSync(ca) !== existsSync(caKey)) throw new Error('LAN証明書のCAと秘密鍵の組が不足しています。既存ファイルを確認してください');
  if (!existsSync(ca)) {
    const config = resolve(directory, 'ca.cnf');
    writeFileSync(config, '[req]\ndistinguished_name=dn\nx509_extensions=ca\nprompt=no\n[dn]\nCN=Nyamuru LAN private CA\n[ca]\nbasicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n', { mode: 0o600 });
    run(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1825', '-keyout', caKey, '-out', ca, '-config', config]);
  }
  const authority = new X509Certificate(readFileSync(ca));
  if (Date.parse(authority.validTo) < Date.now() + 86400_000) throw new Error('LAN用CAの有効期限が近づいています。証明書を更新してください');
  let usable = false;
  if (existsSync(cert) && existsSync(key)) {
    try {
      const previous = new X509Certificate(readFileSync(cert));
      usable = previous.verify(authority.publicKey) && Date.parse(previous.validTo) > Date.now() + 7 * 86400_000
        && hosts.every(value => isIP(value) ? previous.checkIP(value) : previous.checkHost(value));
    } catch { /* Regenerate only the leaf certificate; the client's CA trust stays valid. */ }
  }
  if (!usable) {
    if (!hosts.length || hosts.some(value => !isIP(value) && !/^[a-z0-9][a-z0-9.-]*$/i.test(value))) throw new Error('LAN接続先の名前が正しくありません');
    const config = resolve(directory, 'server.cnf');
    writeFileSync(config, `[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=Nyamuru LAN\n[server]\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=${hosts.map(value => `${isIP(value) ? 'IP' : 'DNS'}:${value}`).join(',')}\n`, { mode: 0o600 });
    const csr = resolve(directory, 'server.csr');
    run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-keyout', key, '-out', csr, '-config', config]);
    run(['x509', '-req', '-in', csr, '-CA', ca, '-CAkey', caKey, '-CAcreateserial', '-days', '365', '-sha256', '-out', cert, '-extfile', config, '-extensions', 'server']);
  }
  chmodSync(caKey, 0o600); chmodSync(key, 0o600);
  return { caPath: ca, fingerprint: authority.fingerprint256, cert: readFileSync(cert), key: readFileSync(key) };
}
