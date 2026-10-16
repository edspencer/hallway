// Functional checks of fronted mode, shared by `hallway setup` (is a step already done? did it work?) and `hallway
// doctor`: ask the real thing rather than read config files, so a redirect a firewall reload wiped, or a resolver
// file the OS ignores, shows up as what it is.
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs';
import http from 'node:http';
import tls from 'node:tls';
import { CA_NAME } from './caddy.js';

export interface HttpAnswer {
  status: number;
  server: string | null;
  location: string | null;
}

/** `GET http://127.0.0.1:<port>/` with `Host: <host>`; null if nothing answered. */
export function httpProbe(port: number, host: string, timeoutMs = 2000, address = '127.0.0.1'): Promise<HttpAnswer | null> {
  return new Promise((resolve) => {
    const req = http.request({ host: address, port, path: '/', method: 'GET', headers: { host }, timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ status: res.statusCode ?? 0, server: (res.headers.server as string) ?? null, location: (res.headers.location as string) ?? null });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
    req.end();
  });
}

export interface TlsAnswer {
  /** The leaf's issuer CN. */
  issuer: string | null;
  /** The certificate is valid for the name and chains to Hallway's root (`rootPem`, when given); null without it. */
  ours: boolean | null;
  /** Why it doesn't verify against Hallway's root, if it doesn't. */
  error: string | null;
}

/** A TLS handshake with 127.0.0.1:<port> for `servername`; null if nothing answered. */
export function tlsProbe(port: number, servername: string, rootPem: string | null, timeoutMs = 3000, address = '127.0.0.1'): Promise<TlsAnswer | null> {
  return new Promise((resolve) => {
    // `ca` replaces Node's CA store, so `authorized` means exactly "chains to Hallway's root and names this host"
    const s = tls.connect({ host: address, port, servername, rejectUnauthorized: false, ...(rootPem ? { ca: [rootPem] } : {}), timeout: timeoutMs }, () => {
      const cn = s.getPeerCertificate()?.issuer?.CN;
      const issuer = (Array.isArray(cn) ? cn[0] : cn) ?? null;
      const ours = rootPem ? s.authorized : null;
      const error = rootPem && !s.authorized ? String(s.authorizationError ?? 'not trusted') : null;
      s.end();
      resolve({ issuer, ours, error });
    });
    s.on('timeout', () => {
      s.destroy();
      resolve(null);
    });
    s.on('error', () => resolve(null));
  });
}

/** Read Hallway's root certificate (PEM) and its fingerprints, or null if Caddy hasn't made it yet. */
export function readRoot(file: string): { pem: string; sha1: string; sha256: string; subject: string } | null {
  try {
    const pem = fs.readFileSync(file, 'utf8');
    const x = new crypto.X509Certificate(pem);
    return { pem, sha1: x.fingerprint.replace(/:/g, ''), sha256: x.fingerprint256.replace(/:/g, ''), subject: x.subject.replace(/^CN=/, '') };
  } catch {
    return null;
  }
}

/** Is this a root Hallway's Caddy made? (`Hallway Local CA - 2026 ECC Root`.) */
export const isHallwayRoot = (subject: string) => subject.startsWith(CA_NAME);

/** What `name` resolves to through the system resolver (getaddrinfo, as browsers mostly use); [] if it doesn't. */
export async function resolve(name: string): Promise<string[]> {
  try {
    return (await dns.lookup(name, { all: true })).map((a) => a.address);
  } catch {
    return [];
  }
}

export const isLoopback = (a: string) => a === '::1' || a.startsWith('127.');
