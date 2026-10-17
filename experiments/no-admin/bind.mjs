// Try to listen on each host:port as the current user and report what happened. Never leaves anything listening.
import net from 'node:net';
import os from 'node:os';

const targets = process.argv.slice(2);
const results = [];
for (const t of targets) {
  const i = t.lastIndexOf(':');
  const host = t.slice(0, i).replace(/^\[|\]$/g, '');
  const port = Number(t.slice(i + 1));
  const r = await new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', (e) => resolve(e.code));
    s.listen({ host, port, ipv6Only: host.includes(':') }, () => s.close(() => resolve('OK')));
  });
  results.push(`${t.padEnd(18)} ${r}`);
}
console.log(`uid=${process.getuid?.()} user=${os.userInfo().username} ${os.platform()} ${os.release()}`);
console.log(results.join('\n'));
