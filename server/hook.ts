// `hallway hook check-command`: an optional pre-tool-use hook for coding agents (docs/06-agent-interface.md, "Changing
// agent habits"; D49). It reads the agent's hook payload on stdin and, when the shell command it's about to run starts
// a dev server directly (`npm run dev`, `vite`, `astro dev`, `python -m http.server`, …), blocks it with a message
// suggesting the equivalent `hallway run`, which keeps the server running outside the agent's session on a stable
// port. Anything else, including a payload it can't read, is let through silently: a hook must never get in the way
// of work it doesn't understand.
//
// The payload and the blocking convention are Claude Code's `PreToolUse` hook (`11-research-notes.md`, Q-HOOK): the
// command is `tool_input.command`; to block, print `{"hookSpecificOutput": {"hookEventName": "PreToolUse",
// "permissionDecision": "deny", "permissionDecisionReason": "…"}}` and exit 0.
import path from 'node:path';

export interface Detection {
  /** The part of the command line that starts the server, as written (env assignments and wrappers removed). */
  segment: string;
  /** What it is, for the message: "a Vite dev server", "an npm script (dev)". */
  what: string;
  /** The command to hand to `hallway run`, made to listen on $PORT where the tool needs a flag for it. */
  command: string;
  /** Whether `command` already passes the port: if not, the message says the server must read $PORT. */
  portHandled: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// A small shell-words reader: enough to split `a && b; c | d &` into simple commands and each into words, honouring
// quotes and backslashes. It doesn't expand anything; it only has to find what runs.
// ---------------------------------------------------------------------------------------------------------------

export function splitCommands(line: string): { text: string; words: string[] }[] {
  const out: { text: string; words: string[] }[] = [];
  let words: string[] = [];
  let word = '';
  let inWord = false;
  let start = 0;
  let quote: '"' | "'" | null = null;
  const endWord = () => {
    if (inWord) words.push(word);
    word = '';
    inWord = false;
  };
  const endCommand = (i: number) => {
    endWord();
    if (words.length) out.push({ text: line.slice(start, i).trim(), words });
    words = [];
  };
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === '\\' && quote === '"' && i + 1 < line.length) word += line[++i];
      else word += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
    } else if (ch === '\\' && i + 1 < line.length) {
      if (line[i + 1] !== '\n') {
        word += line[i + 1];
        inWord = true;
      }
      i++;
    } else if (ch === '#' && !inWord) {
      // a comment runs to the end of the line
      const nl = line.indexOf('\n', i);
      endCommand(i);
      if (nl < 0) break;
      i = nl;
      start = i + 1;
    } else if (ch === '>' || ch === '<' || (ch === '&' && line[i + 1] === '>')) {
      // a redirection (`> log`, `2>&1`, `&> out`, `< in`): neither it nor its target is a word of the command
      if (inWord && /^\d+$/.test(word)) {
        word = '';
        inWord = false;
      } else endWord();
      if (ch === '&') i++;
      while (line[i + 1] === '>' || line[i + 1] === '<') i++;
      if (line[i + 1] === '&') {
        i++;
        while (i + 1 < line.length && /[\d-]/.test(line[i + 1])) i++;
        continue;
      }
      while (line[i + 1] === ' ' || line[i + 1] === '\t') i++;
      // skip the target word (quotes included)
      let q: string | null = null;
      while (i + 1 < line.length) {
        const c = line[i + 1];
        if (q) {
          if (c === q) q = null;
        } else if (c === '"' || c === "'") q = c;
        else if (' \t;|&\n()<>'.includes(c)) break;
        i++;
      }
    } else if (ch === ';' || ch === '\n' || ch === '|' || ch === '&' || ch === '(' || ch === ')') {
      endCommand(i);
      while (i + 1 < line.length && (line[i + 1] === '|' || line[i + 1] === '&') && (ch === '|' || ch === '&')) i++;
      start = i + 1;
    } else if (ch === ' ' || ch === '\t') endWord();
    else {
      word += ch;
      inWord = true;
    }
  }
  endCommand(line.length);
  return out;
}

/** Strip what only wraps the real command: `FOO=1`, `env -i A=b`, `exec`, `nohup`, `time`, `timeout 30`, `sudo`. */
function unwrap(words: string[]): string[] {
  let w = [...words];
  for (;;) {
    if (w.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0])) w = w.slice(1);
    else if (w[0] === 'env') {
      w = w.slice(1);
      while (w.length && (w[0].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]))) w = w.slice(1);
    } else if (['exec', 'nohup', 'time', 'command', 'builtin', 'caffeinate', 'sudo'].includes(w[0])) {
      w = w.slice(1);
      while (w.length && w[0].startsWith('-')) w = w.slice(1);
    }
    else if (w[0] === 'timeout' || w[0] === 'gtimeout') {
      // timeout [-s SIG] [-k DUR] [--foreground] DURATION command…
      let i = 1;
      while (i < w.length && w[i].startsWith('-')) i += w[i] === '-s' || w[i] === '-k' || w[i] === '--signal' || w[i] === '--kill-after' ? 2 : 1;
      w = w.slice(i + 1);
    } else return w;
  }
}

const base = (w: string | undefined) => (w ? path.posix.basename(w) : '');

/** Script names that start a server: `dev`, `start`, `serve`, `preview`, `watch`, `develop`, and `dev:web` and the like. */
const SERVER_SCRIPT = /^(dev|start|serve|server|preview|watch|develop)([:._-][\w:.-]*)?$/;

/** Flags that mean "just tell me something": never a server. */
const INFO_FLAGS = new Set(['--help', '-h', '--version', '-v', '-V']);

interface Tool {
  /** Does `args` (the words after the tool's name) start a server? */
  serves(args: string[]): boolean;
  what: string;
  /** The flags that make it listen on $PORT, if it needs any. */
  port?: (args: string[]) => string[] | null;
}

const sub = (...names: string[]) => (args: string[]) => names.includes(args.find((a) => !a.startsWith('-')) ?? '');
const hasPort = (args: string[], ...flags: string[]) => args.some((a) => flags.some((f) => a === f || a.startsWith(`${f}=`)));
const portFlag = (flag: string, extra: string[] = []) => (args: string[]) => (hasPort(args, flag) ? null : [flag, "'$PORT'", ...extra]);

const TOOLS: Record<string, Tool> = {
  vite: { what: 'a Vite dev server', serves: (a) => !['build', 'optimize'].includes(a.find((x) => !x.startsWith('-')) ?? ''), port: portFlag('--port', ['--strictPort']) },
  astro: { what: 'an Astro dev server', serves: sub('dev', 'preview', 'start'), port: portFlag('--port') },
  next: { what: 'a Next.js server', serves: sub('dev', 'start'), port: (a) => (hasPort(a, '-p', '--port') ? null : ['-p', "'$PORT'"]) },
  nuxt: { what: 'a Nuxt dev server', serves: sub('dev', 'preview', 'start'), port: portFlag('--port') },
  nuxi: { what: 'a Nuxt dev server', serves: sub('dev', 'preview'), port: portFlag('--port') },
  remix: { what: 'a Remix dev server', serves: sub('dev') },
  'react-router': { what: 'a React Router dev server', serves: sub('dev'), port: portFlag('--port') },
  'react-scripts': { what: 'a Create React App dev server', serves: sub('start') },
  webpack: { what: 'a webpack dev server', serves: sub('serve', 'server') , port: portFlag('--port') },
  'webpack-dev-server': { what: 'a webpack dev server', serves: () => true, port: portFlag('--port') },
  ng: { what: 'an Angular dev server', serves: sub('serve', 's'), port: portFlag('--port') },
  'svelte-kit': { what: 'a SvelteKit dev server', serves: sub('dev', 'preview'), port: portFlag('--port') },
  gatsby: { what: 'a Gatsby dev server', serves: sub('develop', 'serve'), port: portFlag('--port') },
  docusaurus: { what: 'a Docusaurus server', serves: sub('start', 'serve'), port: portFlag('--port') },
  vitepress: { what: 'a VitePress dev server', serves: sub('dev', 'preview', 'serve'), port: portFlag('--port') },
  storybook: { what: 'a Storybook server', serves: sub('dev'), port: portFlag('--port', ['--ci']) },
  'start-storybook': { what: 'a Storybook server', serves: () => true, port: portFlag('--port', ['--ci']) },
  eleventy: { what: 'an Eleventy dev server', serves: (a) => a.includes('--serve') || a.includes('--watch'), port: portFlag('--port') },
  '@11ty/eleventy': { what: 'an Eleventy dev server', serves: (a) => a.includes('--serve') || a.includes('--watch'), port: portFlag('--port') },
  parcel: { what: 'a Parcel dev server', serves: (a) => !['build'].includes(a.find((x) => !x.startsWith('-')) ?? ''), port: portFlag('--port') },
  wrangler: { what: 'a Wrangler dev server', serves: sub('dev'), port: portFlag('--port') },
  'http-server': { what: 'a static file server', serves: () => true, port: portFlag('-p') },
  serve: { what: 'a static file server', serves: () => true, port: (a) => (hasPort(a, '-l', '--listen', '-p') ? null : ['-l', "'$PORT'"]) },
  'live-server': { what: 'a static file server', serves: () => true, port: portFlag('--port') },
  'json-server': { what: 'a JSON server', serves: () => true, port: portFlag('--port') },
  'browser-sync': { what: 'a BrowserSync server', serves: sub('start'), port: portFlag('--port') },
  hugo: { what: 'a Hugo server', serves: sub('server', 'serve'), port: portFlag('--port') },
  jekyll: { what: 'a Jekyll server', serves: sub('serve', 's', 'server'), port: portFlag('--port') },
  mkdocs: { what: 'an MkDocs server', serves: sub('serve'), port: (a) => (hasPort(a, '-a', '--dev-addr') ? null : ['--dev-addr', "'127.0.0.1:$PORT'"]) },
  rails: { what: 'a Rails server', serves: sub('server', 's'), port: portFlag('-p') },
  flask: { what: 'a Flask server', serves: sub('run'), port: portFlag('--port') },
  uvicorn: { what: 'a Uvicorn server', serves: () => true, port: portFlag('--port') },
  hypercorn: { what: 'a Hypercorn server', serves: () => true },
  gunicorn: { what: 'a Gunicorn server', serves: () => true },
  fastapi: { what: 'a FastAPI server', serves: sub('dev', 'run'), port: portFlag('--port') },
  streamlit: { what: 'a Streamlit app', serves: sub('run'), port: portFlag('--server.port') },
  jupyter: { what: 'a Jupyter server', serves: sub('notebook', 'lab', 'server'), port: portFlag('--port') },
  'jupyter-lab': { what: 'a Jupyter server', serves: () => true, port: portFlag('--port') },
  nodemon: { what: 'a nodemon-watched process', serves: () => true },
};

/** `npm run dev`, `pnpm dev`, `yarn start`, `bun run dev`, `deno task dev`: the script name, if this runs one. */
/** Package-manager options that take a value (`--prefix web`), so the value isn't taken for a command. */
const PM_VALUE_FLAGS = new Set(['--prefix', '-w', '--workspace', '--filter', '-F', '-C', '--dir', '--cwd', '--loglevel', '--reporter']);

function packageScript(w: string[]): { runner: string; script: string } | null {
  const cmd = base(w[0]);
  let rest = w.slice(1);
  // `yarn workspace web dev`, `yarn workspaces foreach run dev`: the script follows the workspace's name
  if (cmd === 'yarn' && rest[0] === 'workspace') rest = rest.slice(2);
  const args: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--') {
      args.push('--');
      break;
    }
    if (PM_VALUE_FLAGS.has(rest[i])) i++;
    else if (!rest[i].startsWith('-')) args.push(rest[i]);
  }
  const first = args[0];
  if (cmd === 'npm') {
    if (first === 'start') return { runner: 'npm', script: 'start' };
    if ((first === 'run' || first === 'run-script') && args[1] && args[1] !== '--') return { runner: 'npm', script: args[1] };
    return null;
  }
  if (cmd === 'pnpm' || cmd === 'yarn' || cmd === 'bun') {
    if (first === 'run' && args[1] && args[1] !== '--') return { runner: cmd, script: args[1] };
    // `pnpm dev`, `yarn dev`: anything that isn't one of the tool's own commands runs a script; only server-ish
    // script names matter here, and none of them is a built-in except `start` (which runs the script anyway)
    if (first && SERVER_SCRIPT.test(first) && !(cmd === 'bun' && first !== 'dev' && first !== 'start')) return { runner: cmd, script: first };
    return null;
  }
  if (cmd === 'deno' && first === 'task' && args[1]) return { runner: 'deno', script: args[1] };
  return null;
}

/** `npx vite`, `pnpm exec vite`, `pnpm dlx serve`, `yarn dlx`, `bunx`, `bun x`, `uv run`, `poetry run`, `bundle exec`: the words after the runner. */
function viaRunner(w: string[]): string[] | null {
  const cmd = base(w[0]);
  const skipFlags = (a: string[]) => {
    let i = 0;
    while (i < a.length && a[i].startsWith('-')) i += a[i] === '-p' || a[i] === '--package' ? 2 : 1;
    return a.slice(i);
  };
  if (cmd === 'npx' || cmd === 'bunx' || cmd === 'pnpx') return skipFlags(w.slice(1));
  if ((cmd === 'pnpm' || cmd === 'yarn' || cmd === 'bun' || cmd === 'npm') && ['exec', 'dlx', 'x'].includes(w[1])) return skipFlags(w.slice(2)).filter((x) => x !== '--');
  if ((cmd === 'uv' || cmd === 'poetry' || cmd === 'pipenv' || cmd === 'pdm' || cmd === 'hatch') && w[1] === 'run') return skipFlags(w.slice(2));
  if (cmd === 'bundle' && w[1] === 'exec') return w.slice(2);
  return null;
}

/** A word naming a tool: `vite`, `./node_modules/.bin/vite`, `vite@5`, `@11ty/eleventy@2`. */
function toolName(word: string): string {
  if (word.startsWith('@')) return word.replace(/@[^@/]*$/, (m) => (m.includes('/') ? m : ''));
  return base(word).replace(/@.*$/, '');
}

const isPython = (w: string) => /^python(\d+(\.\d+)?)?$/.test(base(w));
const isNode = (w: string) => base(w) === 'node' || base(w) === 'bun' || base(w) === 'deno';
const quote = (w: string) => (/^[\w@%+=:,./'$-]+$/.test(w) ? w : `'${w.replace(/'/g, `'\\''`)}'`);
const join = (w: string[]) => w.map((x) => (x.includes("'$PORT'") || x === "'127.0.0.1:$PORT'" ? x : quote(x))).join(' ');

/** Does this one simple command start a dev server? */
export function detectOne(words: string[], text: string): Detection | null {
  const w = unwrap(words);
  if (!w.length) return null;
  const cmd = base(w[0]);
  // `hallway run …` is the point; and no other hallway command starts a server outside hallway either
  if (cmd === 'hallway' || cmd === 'hw') return null;
  if (w.some((x) => INFO_FLAGS.has(x))) return null;
  const segment = join(w);

  // python -m http.server [port], python manage.py runserver, python -m flask run / uvicorn / …
  if (isPython(w[0])) {
    const m = w.indexOf('-m');
    if (m > 0 && w[m + 1]) {
      const mod = w[m + 1];
      const args = w.slice(m + 2);
      if (mod === 'http.server' || mod === 'SimpleHTTPServer') {
        const rest = args.filter((a) => !/^\d+$/.test(a));
        return { segment, what: 'a static file server', command: join([w[0], '-m', mod, "'$PORT'", ...rest]), portHandled: true };
      }
      if (TOOLS[mod]?.serves(args)) return detectOne([mod, ...args], text);
      return null;
    }
    if (base(w[1] ?? '') === 'manage.py' && w[2] === 'runserver') {
      const rest = w.slice(3).filter((a) => !/^[\d.:]+$/.test(a));
      return { segment, what: 'a Django dev server', command: join([w[0], w[1], 'runserver', "'127.0.0.1:$PORT'", ...rest]), portHandled: true };
    }
    return null;
  }
  // php -S localhost:8000
  if (cmd === 'php' && w.includes('-S')) {
    const i = w.indexOf('-S');
    return { segment, what: 'a PHP built-in server', command: join([...w.slice(0, i), '-S', "'127.0.0.1:$PORT'", ...w.slice(i + 2)]), portHandled: true };
  }

  const script = packageScript(w);
  if (script) {
    if (!SERVER_SCRIPT.test(script.script)) return null;
    const command = withPort(w);
    return { segment, what: `${script.runner === 'npm' ? 'an' : 'a'} ${script.runner} script (${script.script})`, command, portHandled: command !== segment };
  }

  const run = viaRunner(w);
  const tw = run ?? (isNode(w[0]) && w[1] && !w[1].startsWith('-') && TOOLS[toolName(w[1])] ? w.slice(1) : w);
  if (!tw.length) return null;
  const name = toolName(tw[0]);
  const tool = TOOLS[name];
  if (!tool || !tool.serves(tw.slice(1))) return null;
  const port = tool.port?.(tw.slice(1));
  return { segment, what: tool.what, command: port ? `${segment} ${port.join(' ')}` : withPort(w), portHandled: port !== undefined };
}

/** A fixed port in the command (`--port 3000`, `-p=8080`) becomes `'$PORT'`: Hallway picks the port. */
function withPort(w: string[]): string {
  const out = [...w];
  for (let i = 0; i < out.length; i++) {
    const m = /^(--port|-p|--listen|-l)=\d+$/.exec(out[i]);
    if (m) out[i] = `${m[1]}='$PORT'`;
    else if (['--port', '-p', '--listen', '-l'].includes(out[i]) && /^\d+$/.test(out[i + 1] ?? '')) out[++i] = "'$PORT'";
  }
  return join(out);
}

/** The first part of a shell command line that starts a dev server directly, or null. */
export function detectDevServer(commandLine: string): Detection | null {
  for (const c of splitCommands(commandLine)) {
    const d = detectOne(c.words, c.text);
    if (d) return d;
  }
  return null;
}

/** A slug for the suggestion: the working directory's name, made slug-shaped. */
export function suggestSlug(cwd: string | undefined): string {
  const s = (cwd ? path.basename(cwd) : '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
  return s && s !== 'hallway' ? s : 'my-app';
}

export function blockMessage(d: Detection, cwd: string | undefined): string {
  const slug = suggestSlug(cwd);
  const lines = [
    `Hallway: don't start ${d.what} directly (\`${d.segment}\`): it would die with this session and land on a port nobody can find.`,
    `Run it with Hallway instead, which keeps it running outside this session on a stable port and prints its URL:`,
    ``,
    `    hallway run ${slug} -- ${d.command}`,
    ``,
  ];
  if (!d.portHandled) lines.push(`The server must listen on $PORT (set for it); if it needs a flag for that, add it in single quotes, e.g. \`-- --port '$PORT'\` for Vite.`);
  lines.push(`\`hallway run ${slug}\` again restarts it; \`hallway status\` lists what's running; \`hallway logs ${slug}\` shows its output.`);
  return lines.join('\n');
}

export interface HookResult {
  /** What to print on stdout (Claude Code's decision JSON), or empty. */
  stdout: string;
  exitCode: number;
}

/** The whole hook: a payload in, a decision out. Never blocks what it can't read. */
export function checkCommand(payloadText: string): HookResult {
  let payload: { tool_input?: { command?: unknown }; cwd?: unknown; hook_event_name?: unknown };
  try {
    payload = JSON.parse(payloadText);
  } catch {
    return { stdout: '', exitCode: 0 };
  }
  const command = payload?.tool_input?.command;
  if (typeof command !== 'string') return { stdout: '', exitCode: 0 };
  const d = detectDevServer(command);
  if (!d) return { stdout: '', exitCode: 0 };
  const reason = blockMessage(d, typeof payload.cwd === 'string' ? payload.cwd : undefined);
  const out = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } };
  return { stdout: JSON.stringify(out) + '\n', exitCode: 0 };
}
