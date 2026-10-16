// Logs the test user in through Home Assistant's auth API once and stores the
// tokens the frontend expects in localStorage, so every test starts logged in.
import { mkdir, writeFile } from "node:fs/promises";

export default async function globalSetup(config) {
  const base = config.projects[0].use.baseURL;
  const clientId = `${base}/`;
  const json = (r) => {
    if (!r.ok) throw new Error(`${r.url}: HTTP ${r.status}`);
    return r.json();
  };
  const post = (path, body) =>
    fetch(base + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(json);

  const flow = await post("/auth/login_flow", {
    client_id: clientId,
    handler: ["homeassistant", null],
    redirect_uri: clientId,
  });
  const step = await post(`/auth/login_flow/${flow.flow_id}`, {
    client_id: clientId,
    username: process.env.HASS_USERNAME || "test",
    password: process.env.HASS_PASSWORD || "test",
  });
  if (step.type !== "create_entry") throw new Error(`Login failed: ${JSON.stringify(step)}`);
  const tokens = await fetch(`${base}/auth/token`, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: step.result,
      client_id: clientId,
    }),
  }).then(json);

  const hassTokens = {
    ...tokens,
    hassUrl: base,
    clientId,
    expires: Date.now() + tokens.expires_in * 1000,
  };
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/.auth.json",
    JSON.stringify({
      cookies: [],
      origins: [
        { origin: base, localStorage: [{ name: "hassTokens", value: JSON.stringify(hassTokens) }] },
      ],
    }),
  );
}
