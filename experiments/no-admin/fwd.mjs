// Run by a LaunchAgent with inetdCompatibility { Wait = true }: launchd passes the listening socket as fd 0.
// Accept on it and pipe every connection, byte for byte, to Caddy on 127.0.0.1:<port> (TLS stays end to end).
import net from 'node:net';

const port = Number(process.argv[2]);
const server = net.createServer((c) => {
  const u = net.connect(port, '127.0.0.1');
  c.pipe(u).pipe(c);
  c.on('error', () => u.destroy());
  u.on('error', () => c.destroy());
});
server.listen({ fd: 0 }, () => console.log(`forwarding fd 0 (${JSON.stringify(server.address())}) -> 127.0.0.1:${port}`));
