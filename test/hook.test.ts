// server/hook.ts: which commands `hallway hook check-command` blocks, what it suggests instead, and that it lets
// through everything else, including payloads it can't read. The tables are the contract: add to them, don't loosen them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { checkCommand, detectDevServer, splitCommands, suggestSlug } from '../server/hook.ts';
import { ROOT, tmpDir } from './fixture.ts';

/** Command → the `hallway run` command suggested for it. */
const BLOCKED: [string, string][] = [
  ['npm run dev', 'npm run dev'],
  ['npm start', 'npm start'],
  ['npm run dev -- --port 3000', "npm run dev -- --port '$PORT'"],
  ['cd web && npm run dev', 'npm run dev'],
  ['npm --prefix web run dev', 'npm --prefix web run dev'],
  ['npm run dev:web', 'npm run dev:web'],
  ['npm run start:prod', 'npm run start:prod'],
  ['pnpm dev', 'pnpm dev'],
  ['pnpm run preview', 'pnpm run preview'],
  ['pnpm --filter web dev', 'pnpm --filter web dev'],
  ['yarn dev', 'yarn dev'],
  ['yarn start', 'yarn start'],
  ['yarn workspace web dev', 'yarn workspace web dev'],
  ['bun run dev', 'bun run dev'],
  ['bun dev', 'bun dev'],
  ['deno task dev', 'deno task dev'],
  ['vite', "vite --port '$PORT' --strictPort"],
  ['vite dev --host', "vite dev --host --port '$PORT' --strictPort"],
  ['vite preview', "vite preview --port '$PORT' --strictPort"],
  ['npx vite', "npx vite --port '$PORT' --strictPort"],
  ['npx --yes vite@5 --port 5173', "npx --yes vite@5 --port '$PORT'"],
  ['pnpm exec vite', "pnpm exec vite --port '$PORT' --strictPort"],
  ['./node_modules/.bin/vite', "./node_modules/.bin/vite --port '$PORT' --strictPort"],
  ['astro dev', "astro dev --port '$PORT'"],
  ['npx astro dev', "npx astro dev --port '$PORT'"],
  ['next dev', "next dev -p '$PORT'"],
  ['next dev -p 3001', "next dev -p '$PORT'"],
  ['next start', "next start -p '$PORT'"],
  ['nuxi dev', "nuxi dev --port '$PORT'"],
  ['ng serve', "ng serve --port '$PORT'"],
  ['npx webpack serve', "npx webpack serve --port '$PORT'"],
  ['npx serve dist', "npx serve dist -l '$PORT'"],
  ['npx http-server .', "npx http-server . -p '$PORT'"],
  ['npx @11ty/eleventy --serve', "npx @11ty/eleventy --serve --port '$PORT'"],
  ['npx storybook dev', "npx storybook dev --port '$PORT' --ci"],
  ['wrangler dev', "wrangler dev --port '$PORT'"],
  ['python -m http.server', "python -m http.server '$PORT'"],
  ['python3 -m http.server 8000', "python3 -m http.server '$PORT'"],
  ['python3 -m http.server 8000 --bind 127.0.0.1', "python3 -m http.server '$PORT' --bind 127.0.0.1"],
  ['python manage.py runserver', "python manage.py runserver '127.0.0.1:$PORT'"],
  ['python -m uvicorn app:app', "python -m uvicorn app:app --port '$PORT'"],
  ['uvicorn main:app --reload', "uvicorn main:app --reload --port '$PORT'"],
  ['uv run fastapi dev', "uv run fastapi dev --port '$PORT'"],
  ['flask run', "flask run --port '$PORT'"],
  ['streamlit run app.py', "streamlit run app.py --server.port '$PORT'"],
  ['jupyter lab', "jupyter lab --port '$PORT'"],
  ['bundle exec jekyll serve', "bundle exec jekyll serve --port '$PORT'"],
  ['bin/rails server', "bin/rails server -p '$PORT'"],
  ['hugo server -D', "hugo server -D --port '$PORT'"],
  ['mkdocs serve', "mkdocs serve --dev-addr '127.0.0.1:$PORT'"],
  ['php -S localhost:8000', "php -S '127.0.0.1:$PORT'"],
  // wrappers, environment, backgrounding and redirections don't hide it
  ['PORT=3000 npm start', 'npm start'],
  ['env NODE_ENV=development npm run dev', 'npm run dev'],
  ['nohup npm run dev > dev.log 2>&1 &', 'npm run dev'],
  ['npm run dev &> /tmp/log &', 'npm run dev'],
  ['timeout 30 npm run dev', 'npm run dev'],
  ['(cd site && npx astro dev)', "npx astro dev --port '$PORT'"],
  ['npm install && npm run dev', 'npm run dev'],
  ['npm run dev | tee log', 'npm run dev'],
];

/** Commands that must never be blocked. */
const ALLOWED = [
  // Hallway itself
  'hallway run demo -- npm run dev',
  "hallway run demo -- vite --port '$PORT' --strictPort",
  'hallway run demo',
  'hallway status',
  // builds, tests, linting, installs
  'npm test',
  'npm run test',
  'npm run build',
  'npm run lint && npm test',
  'npm ci',
  'npm install vite',
  'npm run typecheck',
  'pnpm build',
  'pnpm test',
  'yarn build',
  'bun test',
  'vite build',
  'npx vite build',
  'astro build',
  'astro check',
  'next build',
  'next lint',
  'ng build',
  'ng test',
  'parcel build src/index.html',
  'npx webpack',
  'python -m pytest',
  'python -m pip install flask',
  'python manage.py migrate',
  'python script.py',
  'uv run pytest',
  // asking about a tool is not running it
  'vite --help',
  'next dev --help',
  'npx astro --version',
  // mentions in arguments, strings and comments
  'echo "npm run dev"',
  "git commit -m 'run vite dev'",
  'grep -r "next dev" .',
  'cat package.json | grep dev',
  'ls # npm run dev',
  'rg vite',
  // everything else
  'git status',
  'docker compose up',
  'curl http://localhost:5173',
  'node server.js',
  'node --test',
  '',
];

describe('detectDevServer', () => {
  for (const [cmd, suggestion] of BLOCKED)
    test(`blocks: ${cmd}`, () => {
      const d = detectDevServer(cmd);
      assert.ok(d, `expected ${cmd} to be blocked`);
      assert.equal(d.command, suggestion);
    });
  for (const cmd of ALLOWED)
    test(`allows: ${cmd || '(empty)'}`, () => {
      assert.equal(detectDevServer(cmd), null);
    });
});

describe('splitCommands', () => {
  test('splits on operators outside quotes and drops redirections', () => {
    assert.deepEqual(
      splitCommands(`a 'b c' && d "e;f" | g; h > out 2>&1 &`).map((c) => c.words),
      [['a', 'b c'], ['d', 'e;f'], ['g'], ['h']],
    );
  });
});

describe('suggestSlug', () => {
  test("the working directory's name, slug-shaped", () => {
    assert.equal(suggestSlug('/home/me/Code/My_App'), 'my-app');
    assert.equal(suggestSlug('/'), 'my-app');
    assert.equal(suggestSlug(undefined), 'my-app');
  });
});

describe('checkCommand (the Claude Code PreToolUse payload)', () => {
  const payload = (command: unknown, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ session_id: 's', cwd: '/home/me/Code/shop', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command, description: 'x' }, ...extra });

  test('a dev-server start: a deny decision naming the hallway run command', () => {
    const r = checkCommand(payload('npm run dev'));
    assert.equal(r.exitCode, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /hallway run shop -- npm run dev/);
    assert.match(out.hookSpecificOutput.permissionDecisionReason, /\$PORT/);
  });

  test('anything else, or anything unreadable: no output, exit 0', () => {
    for (const input of [payload('npm test'), payload(42), JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: 'x' } }), 'not json', '', 'null'])
      assert.deepEqual(checkCommand(input), { stdout: '', exitCode: 0 });
  });

  test('the CLI: hallway hook check-command reads stdin', () => {
    const home = tmpDir('hw-hook-');
    const run = (input: string, args = ['hook', 'check-command']) =>
      spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'server/cli.ts'), ...args], {
        input,
        encoding: 'utf8',
        env: { ...process.env, HALLWAY_HOME: home, HOME: home },
        cwd: ROOT,
      });
    const blocked = run(payload('vite'));
    assert.equal(blocked.status, 0);
    assert.equal(JSON.parse(blocked.stdout).hookSpecificOutput.permissionDecision, 'deny');
    const allowed = run(payload('vite build'));
    assert.equal(allowed.status, 0);
    assert.equal(allowed.stdout, '');
    assert.equal(run('', ['hook']).status, 2);
    assert.equal(run('', ['hook', 'nope']).status, 2);
  });
});
