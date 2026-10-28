import { GoogleAuth, OAuth2Client } from 'google-auth-library';

// Prefer ADC; an already authenticated gcloud session can remain usable when
// company reauthentication expires ADC separately. Never store or print tokens.
export async function googleClient(quotaProjectId: string) {
  try {
    const client = await new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] }).getClient();
    client.quotaProjectId = quotaProjectId;
    await client.getAccessToken();
    return client;
  } catch {
    let child;
    try { child = Bun.spawn(['gcloud', 'auth', 'print-access-token', '--quiet'], { stdout: 'pipe', stderr: 'pipe' }); }
    catch { throw new Error('Google deployment authentication expired. Sign in with gcloud or refresh application-default credentials.'); }
    const [token] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);
    if (await child.exited !== 0 || !token.trim()) throw new Error('Google deployment authentication expired. Sign in with gcloud or refresh application-default credentials.');
    const client = new OAuth2Client({ quotaProjectId }); client.setCredentials({ access_token: token.trim() });
    return client;
  }
}
