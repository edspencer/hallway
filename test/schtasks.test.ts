// Managed services on Windows (D60): the job file and task XML against golden files, the scheduled-task lifecycle
// with the command runner mocked, the supervisor (for real: it only spawns Node), and the PATH trap's PATHEXT rules.
// Run on every OS; nothing here touches Task Scheduler. (UPDATE_GOLDEN=1 rewrites the golden files.)
import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { RunResult, ServiceSpec } from '../server/platform/services.ts';
import { jobPath, quoteArg, renderJob, renderTask, schtasksManager, taskEnabled } from '../server/platform/schtasks.ts';
import { cmdQuote, launchArgs, mergeEnv, readState, stateFileOf, supervise } from '../server/platform/supervise.ts';
import { splitCommandLine } from '../server/platform/win32.ts';
import { candidates, which } from '../server/services/resolve.ts';
import { exitWatchdog, ROOT, tmpDir, rmTmp } from './fixture.ts';

await exitWatchdog();

const GOLDEN = path.join(ROOT, 'test', 'fixtures', 'services');
function golden(name: string, actual: string) {
  const f = path.join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(f, actual);
  assert.equal(actual, fs.readFileSync(f, 'utf8'), `${name} differs from its golden file (UPDATE_GOLDEN=1 npm test rewrites it)`);
}
const cleanups: (() => void)[] = [];
after(() => cleanups.forEach((c) => c()));
const tmp = (p: string) => {
  const d = tmpDir(p);
  cleanups.push(() => rmTmp(d));
  return d;
};

const U = 'C:\\Users\\someone';
const review: ServiceSpec = {
  label: 'hallway.app.review',
  description: 'Hallway: Local Review (review)',
  program: ['C:\\Program Files\\nodejs\\node.exe', `${U}\\AppData\\Roaming\\npm\\node_modules\\local-review\\dist\\server\\cli.js`, 'serve', '--quiet'],
  cwd: `${U}\\Code\\local review`,
  env: { PATH: `C:\\Program Files\\nodejs;${U}\\AppData\\Roaming\\npm;C:\\Windows\\system32;C:\\Windows`, HOST: '127.0.0.1', HOSTNAME: '127.0.0.1', PORT: '5622' },
  runAtLoad: true,
  keepAlive: true,
  stdout: `${U}\\.hallway\\logs\\review.out.log`,
  stderr: `${U}\\.hallway\\logs\\review.err.log`,
  node: { path: 'C:\\Program Files\\nodejs\\node.exe', version: 'v24.15.0' },
};
const adhoc: ServiceSpec = { ...review, label: 'hallway.app.demo', description: 'Hallway: demo <&> "quoted" (demo)', runAtLoad: false, keepAlive: false };
const ctx = { user: 'MY-LAPTOP\\someone', supervisor: ['C:\\Program Files\\nodejs\\node.exe', `${U}\\AppData\\Roaming\\npm\\node_modules\\hallway\\dist\\server\\cli.js`, 'supervise'], conhost: 'C:\\Windows\\System32\\conhost.exe' };
const DIR = `${U}\\AppData\\Local\\hallway\\tasks`;

describe('scheduled tasks: the files', () => {
  test('match the golden files', () => {
    golden('review.task.xml', renderTask(review, `${DIR}\\hallway.app.review.json`, ctx));
    golden('demo.task.xml', renderTask(adhoc, `${DIR}\\hallway.app.demo.json`, ctx));
    golden('review.job.json', renderJob(review));
  });

  test('RunAtLoad is a logon trigger for this user; no trigger otherwise; never a stored password', () => {
    const t = renderTask(review, 'x.json', ctx);
    assert.match(t, /<LogonTrigger>[\s\S]*<UserId>MY-LAPTOP\\someone<\/UserId>/);
    assert.match(t, /<LogonType>InteractiveToken<\/LogonType>/);
    assert.match(t, /<RunLevel>LeastPrivilege<\/RunLevel>/);
    assert.match(t, /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
    assert.doesNotMatch(renderTask(adhoc, 'x.json', ctx), /LogonTrigger/);
    assert.match(renderTask(adhoc, 'x.json', ctx), /demo &lt;&amp;&gt; &quot;quoted&quot;/);
  });

  test('the action: conhost --headless, the supervisor, the job file, each argument quoted to split back exactly', () => {
    const t = renderTask(review, `${DIR}\\hallway.app.review.json`, ctx);
    assert.match(t, /<Command>C:\\Windows\\System32\\conhost\.exe<\/Command>/);
    const args = /<Arguments>(.*)<\/Arguments>/.exec(t)![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    assert.deepEqual(splitCommandLine(`conhost.exe ${args}`).slice(1), ['--headless', ...ctx.supervisor, `${DIR}\\hallway.app.review.json`]);
  });

  test('quoting round-trips through the C runtime rules', () => {
    for (const a of ['plain', 'with space', 'C:\\dir with space\\', 'say "hi"', 'a\\\\"b', '', 'tail\\'])
      assert.deepEqual(splitCommandLine(`x.exe ${quoteArg(a)} end`), ['x.exe', a, 'end'], a);
  });

  test('the job file reads back its PATH; the task XML its Enabled', () => {
    assert.equal(jobPath(renderJob(review)), review.env.PATH);
    assert.equal(jobPath('{"env":{"Path":"C:\\\\x"}}'), 'C:\\x');
    assert.equal(jobPath('not json'), null);
    const t = renderTask(review, 'x.json', ctx);
    assert.equal(taskEnabled(t), true);
    assert.equal(taskEnabled(t.replace('<AllowStartOnDemand>true</AllowStartOnDemand>\r\n    <Enabled>true</Enabled>', '<AllowStartOnDemand>true</AllowStartOnDemand>\r\n    <Enabled>false</Enabled>')), false);
    // a disabled task's idle settings and triggers have their own Enabled, which isn't the task's
    assert.equal(taskEnabled('<Settings><IdleSettings><Enabled>false</Enabled></IdleSettings>\n</Settings>'), true);
    assert.equal(taskEnabled('ERROR: The system cannot find the file specified.'), null);
  });
});

function mockRunner(answer: (cmd: string, args: string[]) => Partial<RunResult> | undefined = () => undefined) {
  const calls: string[] = [];
  const run = async (cmd: string, args: string[]): Promise<RunResult> => {
    calls.push([cmd, ...args].join(' '));
    return { code: 0, stdout: '', stderr: '', ...answer(cmd, args) };
  };
  return { calls, run };
}

describe('scheduled tasks: the lifecycle (runner mocked)', () => {
  const queryXml = (enabled: boolean) => renderTask(review, 'x.json', ctx).replace('<Enabled>true</Enabled>\r\n    <Hidden>', `<Enabled>${enabled}</Enabled>\r\n    <Hidden>`);
  const setup = (opts: { registered?: boolean; alive?: number[] } = {}) => {
    const dir = tmp('hw-test-tasks-');
    const m = mockRunner((cmd, args) => (cmd === 'schtasks' && args[0] === '/Query' && !opts.registered ? { code: 1, stderr: 'ERROR: The system cannot find the file specified.' } : cmd === 'schtasks' && args[0] === '/Query' && args.includes('/XML') ? { stdout: queryXml(true) } : undefined));
    const alive = new Set(opts.alive ?? []);
    const mgr = schtasksManager({ dir, run: m.run, ctx, isAlive: (p) => alive.has(p) });
    return { dir, m, mgr, alive };
  };

  test('write: the job file and the XML (UTF-16 with a BOM), registered with /Create /XML; unchanged: nothing', async () => {
    const { dir, m, mgr } = setup();
    assert.equal(await mgr.write(review), true);
    assert.equal(fs.readFileSync(path.join(dir, 'hallway.app.review.json'), 'utf8'), renderJob(review));
    const raw = fs.readFileSync(path.join(dir, 'hallway.app.review.xml'));
    assert.deepEqual([...raw.subarray(0, 2)], [0xff, 0xfe]);
    assert.ok(raw.toString('utf16le').includes('<URI>\\hallway.app.review</URI>'));
    assert.deepEqual(m.calls.map((c) => c.replace(dir, '<dir>')), ['schtasks /Query /TN \\hallway.app.review', `schtasks /Create /TN \\hallway.app.review /XML <dir>${path.sep}hallway.app.review.xml /F`]);
    assert.deepEqual(mgr.list(), ['hallway.app.review']);
  });

  test('start: enable (a stop disabled it), then run; already running: just enable', async () => {
    let s = setup({ registered: true });
    await s.mgr.start(review);
    assert.deepEqual(s.m.calls, ['schtasks /Change /TN \\hallway.app.review /ENABLE', 'schtasks /Query /TN \\hallway.app.review /XML', 'schtasks /Run /TN \\hallway.app.review']);
    s = setup({ registered: true, alive: [10, 11] });
    fs.writeFileSync(stateFileOf(path.join(s.dir, 'hallway.app.review.json')), JSON.stringify({ supervisor: 10, pid: 11, startedAt: null, lastExitCode: null, exitedAt: null }));
    await s.mgr.start(review);
    assert.ok(!s.m.calls.some((c) => c.includes('/Run')));
  });

  test("stop: the supervisor's tree, the task ended, then disabled so the next logon doesn't start it", async () => {
    const s = setup({ registered: true, alive: [10, 11] });
    fs.writeFileSync(stateFileOf(path.join(s.dir, 'hallway.app.review.json')), JSON.stringify({ supervisor: 10, pid: 11, startedAt: null, lastExitCode: null, exitedAt: null }));
    await s.mgr.stop('hallway.app.review');
    assert.deepEqual(s.m.calls, ['taskkill /PID 10 /T /F', 'schtasks /End /TN \\hallway.app.review', 'schtasks /Change /TN \\hallway.app.review /DISABLE']);
  });

  test('status: from the state file and the task; not registered; disabled', async () => {
    let s = setup({ registered: true, alive: [10, 11] });
    const job = path.join(s.dir, 'hallway.app.review.json');
    fs.writeFileSync(job, renderJob(review));
    fs.writeFileSync(stateFileOf(job), JSON.stringify({ supervisor: 10, pid: 11, startedAt: null, lastExitCode: 3, exitedAt: null }));
    assert.deepEqual(await s.mgr.status('hallway.app.review'), { label: 'hallway.app.review', installed: true, loaded: true, running: true, pid: 11, lastExitCode: 3, state: 'running', enabled: true });
    s.alive.delete(11);
    assert.equal((await s.mgr.status('hallway.app.review')).state, 'stopped');
    s = setup();
    assert.deepEqual(await s.mgr.status('hallway.app.review'), { label: 'hallway.app.review', installed: false, loaded: false, running: false, pid: null, lastExitCode: null, state: null, enabled: null });
  });

  test('restart and remove', async () => {
    const s = setup({ registered: true, alive: [10] });
    await s.mgr.write(review);
    fs.writeFileSync(stateFileOf(path.join(s.dir, 'hallway.app.review.json')), JSON.stringify({ supervisor: 10, pid: null, startedAt: null, lastExitCode: null, exitedAt: null }));
    s.m.calls.length = 0;
    await s.mgr.restart(review);
    assert.deepEqual(s.m.calls, ['taskkill /PID 10 /T /F', 'schtasks /End /TN \\hallway.app.review', 'schtasks /Change /TN \\hallway.app.review /ENABLE', 'schtasks /Run /TN \\hallway.app.review']);
    s.m.calls.length = 0;
    s.alive.clear();
    await s.mgr.remove('hallway.app.review');
    assert.deepEqual(s.m.calls, ['schtasks /End /TN \\hallway.app.review', 'schtasks /Delete /TN \\hallway.app.review /F']);
    assert.deepEqual(fs.readdirSync(s.dir), []);
  });

  test('no schtasks: explained', async () => {
    const m = mockRunner(() => ({ code: 127 }));
    await assert.rejects(schtasksManager({ dir: tmp('hw-test-tasks-'), run: m.run, ctx }).start(review), /Task Scheduler on Windows/);
  });
});

describe('the supervisor', () => {
  test("the job's environment wins over the user's, whatever case Windows spelt a name in", () => {
    assert.deepEqual(mergeEnv({ Path: 'C:\\old', SystemRoot: 'C:\\Windows' }, { PATH: 'C:\\new', PORT: '1' }), { SystemRoot: 'C:\\Windows', PATH: 'C:\\new', PORT: '1' });
    assert.deepEqual(mergeEnv({ Path: '/a' }, { PATH: '/b' }, false), { Path: '/a', PATH: '/b' });
  });

  test('a .cmd or .bat program runs through cmd.exe, quoted; anything else directly', () => {
    assert.deepEqual(launchArgs(['C:\\npm\\npx.cmd', 'vite', '--port', '5173']), { cmd: 'cmd.exe', args: ['/d', '/s', '/c', '"C:\\npm\\npx.cmd vite --port 5173"'], verbatim: true });
    assert.deepEqual(launchArgs(['C:\\x\\run.BAT', 'a b', 'say "hi"'], 'C:\\Windows\\system32\\cmd.exe').args[3], '"C:\\x\\run.BAT "a b" "say ""hi""""');
    assert.deepEqual(launchArgs(['/usr/bin/python3', '-m', 'http.server']), { cmd: '/usr/bin/python3', args: ['-m', 'http.server'], verbatim: false });
    assert.equal(cmdQuote('C:\\Program Files\\x'), '"C:\\Program Files\\x"');
  });

  test('runs the job with its logs and environment, records its PID and exit, and restarts it with keepAlive', async () => {
    const dir = tmp('hw-test-supervise-');
    const counter = path.join(dir, 'runs');
    const job = path.join(dir, 'hallway.app.x.json');
    const script = `const fs=require('fs');const n=(fs.existsSync(${JSON.stringify(counter)})?Number(fs.readFileSync(${JSON.stringify(counter)},'utf8')):0)+1;fs.writeFileSync(${JSON.stringify(counter)},String(n));console.log('run',n,process.env.GREETING);console.error('err',n);if(n>=2){const s=JSON.parse(fs.readFileSync(${JSON.stringify(job)},'utf8'));s.keepAlive=false;fs.writeFileSync(${JSON.stringify(job)},JSON.stringify(s))}process.exit(n+2)`;
    const spec: ServiceSpec = { label: 'hallway.app.x', description: 'x', program: [process.execPath, '-e', script], cwd: dir, env: { GREETING: 'hello' }, runAtLoad: false, keepAlive: true, stdout: path.join(dir, 'logs', 'x.out.log'), stderr: path.join(dir, 'logs', 'x.err.log'), node: null };
    fs.writeFileSync(job, JSON.stringify(spec));
    const code = await supervise(job, { restartSec: 0.05 });
    // it read the job file again before the second run, which turned keepAlive off: two runs, then done
    assert.equal(code, 4);
    assert.equal(fs.readFileSync(spec.stdout, 'utf8'), 'run 1 hello\nrun 2 hello\n');
    assert.equal(fs.readFileSync(spec.stderr, 'utf8'), 'err 1\nerr 2\n');
    const st = readState(stateFileOf(job))!;
    assert.equal(st.supervisor, process.pid);
    assert.equal(st.pid, null);
    assert.equal(st.lastExitCode, 4);
  });

  test("a program that can't start: said in its error log, exit 127", async () => {
    const dir = tmp('hw-test-supervise-');
    const job = path.join(dir, 'hallway.app.y.json');
    fs.writeFileSync(job, JSON.stringify({ label: 'hallway.app.y', program: [path.join(dir, 'missing-program')], cwd: dir, env: {}, keepAlive: false, stdout: path.join(dir, 'y.out.log'), stderr: path.join(dir, 'y.err.log') }));
    assert.equal(await supervise(job), 127);
    assert.match(fs.readFileSync(path.join(dir, 'y.err.log'), 'utf8'), /^hallway: couldn't start .*missing-program/);
  });
});

describe('the PATH trap: PATHEXT', () => {
  test('a bare name is looked for with each extension; one that has an extension is taken as it is', () => {
    assert.deepEqual(candidates('npx', '.COM;.EXE;.BAT;.CMD'), ['npx.com', 'npx.exe', 'npx.bat', 'npx.cmd']);
    assert.deepEqual(candidates('node.exe', '.COM;.EXE'), ['node.exe']);
    assert.deepEqual(candidates('npx', undefined), ['npx']);
    assert.deepEqual(candidates('my.tool', '.EXE'), ['my.tool.exe']);
  });

  test("npm's extensionless sh shim beside the .cmd is skipped when PATHEXT says so", () => {
    const bin = tmp('hw-test-pathext-');
    for (const f of ['vite', 'vite.cmd']) fs.writeFileSync(path.join(bin, f), '#!/bin/sh\n', { mode: 0o755 });
    assert.equal(which('vite', bin, '.EXE;.CMD'), path.join(bin, 'vite.cmd'));
    assert.equal(which('vite', bin), path.join(bin, 'vite'));
  });
});

describe('specs from the YAML, on a Windows machine', { skip: process.platform !== 'win32' && 'Windows paths, PATHEXT and a ;-separated PATH' }, () => {
  test("npm's .cmd shim, not its sh script; node's directory first on PATH; per-shell directories dropped", async () => {
    const { appSpec } = await import('../server/services/spec.ts');
    const { tmpStore } = await import('./fixture.ts');
    const root = tmp('hw-test-winspec-');
    const nodeDir = path.join(root, 'nodejs');
    const npmBin = path.join(root, 'npm');
    const shell = path.join(root, 'fnm_multishells', '123_456');
    for (const d of [nodeDir, npmBin, shell]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(nodeDir, 'node.exe'), '');
    for (const f of ['vite', 'vite.cmd', 'vite.ps1']) fs.writeFileSync(path.join(npmBin, f), '');
    const s = await tmpStore();
    cleanups.push(s.cleanup);
    await s.store.createApp('demo', { port: 5173, service: { command: ['vite', '--port', '$PORT'], cwd: root, runAtLoad: false, keepAlive: false } });
    const node = { path: path.join(nodeDir, 'node.exe'), version: 'v24.0.0' };
    const env = { PATH: [shell, npmBin, nodeDir, 'C:\\Windows\\System32'].join(';'), PATHEXT: '.COM;.EXE;.BAT;.CMD;.VBS;.JS;.PS1' };
    const spec = appSpec('demo', s.store.apps.get('demo')!.value!, s.home, { env, node });
    assert.deepEqual(spec.program, [path.join(npmBin, 'vite.cmd'), '--port', '5173']);
    const p = spec.env.PATH.split(';');
    assert.equal(p[0], nodeDir);
    assert.ok(p.includes(npmBin) && p.includes('C:\\Windows\\System32'));
    assert.ok(!p.some((d) => d.includes('fnm_multishells')), spec.env.PATH);
    // and `node server.js` is the resolved Node, `node.exe` too
    await s.store.patchApp('demo', { service: { command: ['node.exe', 'server.js'], cwd: root, runAtLoad: false, keepAlive: false } });
    assert.deepEqual(appSpec('demo', s.store.apps.get('demo')!.value!, s.home, { env, node }).program, [node.path, 'server.js']);
  });
});
