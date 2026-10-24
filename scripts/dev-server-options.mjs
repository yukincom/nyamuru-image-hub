function optionValue(args, index, name) {
  const inline = args[index].startsWith(`${name}=`) ? args[index].slice(name.length + 1) : null;
  if (inline !== null) return { value: inline, consumed: 0 };
  const next = args[index + 1];
  if (next && !next.startsWith('-')) return { value: next, consumed: 1 };
  return { value: true, consumed: 0 };
}

export function parseDevOptions(args, { root, defaultHost = '127.0.0.1' }) {
  const options = { root, server: { host: defaultHost } };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--') continue;
    if (argument === '--force') { options.force = true; continue; }
    if (argument === '--verbose') { options.logLevel = 'debug'; continue; }
    if (argument === '--silent') { options.logLevel = 'silent'; continue; }
    if (argument === '--help' || argument === '-h') {
      console.log('Usage: npm run dev -- [--port 4321] [--host [address]] [--open [path]] [--mode name] [--force]');
      return null;
    }
    const known = ['--port', '--host', '--open', '--mode', '--config', '--root', '--allowed-hosts'];
    const name = known.find((candidate) => argument === candidate || argument.startsWith(`${candidate}=`));
    if (!name) throw new Error(`未対応の開発サーバー引数です: ${argument}`);
    const { value, consumed } = optionValue(args, index, name);
    index += consumed;
    if (name === '--port') {
      if (value === true) throw new Error('--portには番号が必要です');
      const port = Number(value);
      if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error(`ポート番号が正しくありません: ${value}`);
      options.server.port = port;
    } else if (name === '--host') options.server.host = value;
    else if (name === '--open') options.server.open = value;
    else if (name === '--mode') {
      if (value === true) throw new Error('--modeには名前が必要です');
      options.mode = String(value);
    } else if (name === '--config') {
      if (value === true) throw new Error('--configにはファイル名が必要です');
      options.configFile = String(value);
    } else if (name === '--root') {
      if (value === true) throw new Error('--rootにはディレクトリが必要です');
      options.root = String(value);
    } else if (name === '--allowed-hosts') {
      options.server.allowedHosts = value === true ? true : String(value).split(',');
    }
  }
  return options;
}
