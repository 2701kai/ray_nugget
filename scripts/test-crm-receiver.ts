import { crmTestFixtures } from './crm-test-fixtures';

const project = 'integrations/crm-intake';
async function command(args: string[], quiet = false, env = process.env) {
  const child = Bun.spawn(args, { env, stdout: quiet ? 'pipe' : 'inherit', stderr: quiet ? 'pipe' : 'inherit' });
  const output = quiet ? await new Response(child.stdout).text() : '';
  const error = quiet ? await new Response(child.stderr).text() : '';
  if (await child.exited) throw new Error(`${args[0]} ${args[1]} failed: ${error}`);
  return output.trim();
}
await Bun.write('.cache/crm-delivery-fixtures.json', JSON.stringify(await crmTestFixtures(), null, 2));
const postgres = process.argv.includes('--postgres');
let container: string | undefined;
try {
  const env = { ...process.env };
  // Do not inherit a caller-supplied database destination into an isolated test.
  delete env.PETE_TEST_POSTGRES_PORT;
  if (postgres) {
    container = `pete-receiver-test-${crypto.randomUUID()}`;
    console.log('Starting an ephemeral localhost PostgreSQL test database…');
    await command(['docker', 'run', '--rm', '-d', '--name', container, '-p', '127.0.0.1::5432',
      '-e', 'POSTGRES_DB=pete_receiver_test', '-e', 'POSTGRES_USER=pete_test', '-e', 'POSTGRES_PASSWORD=synthetic-local-test-only', 'postgres:16-alpine'], true);
    env.PETE_TEST_POSTGRES_PORT = (await command(['docker', 'port', container, '5432'], true)).split(':').at(-1)!;
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      try { await command(['docker', 'exec', container, 'pg_isready', '-U', 'pete_test', '-d', 'pete_receiver_test'], true); ready = true; break; }
      catch { await Bun.sleep(500); }
    }
    if (!ready) throw new Error('Ephemeral PostgreSQL did not start.');
  }
  await command(['uv', 'run', '--frozen', '--project', project, 'python', `${project}/manage.py`, 'makemigrations', '--check', '--dry-run'], false, env);
  await command(['uv', 'run', '--frozen', '--project', project, 'python', `${project}/manage.py`, 'test', 'pete_intake', '--verbosity', '2'], false, env);
} finally {
  if (container) await command(['docker', 'rm', '-f', container], true);
}
