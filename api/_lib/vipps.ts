// Vipps OpenID Connect ("Logg inn med Vipps"). Keys live as Vercel env vars.
// Env var changes take effect only on the next deploy.
import type { VercelRequest } from "@vercel/node";
import { sessionSecretOk } from "./session.js";

const DISCOVERY_URL = {
  test:
    "https://apitest.vipps.no/access-management-1.0/access/.well-known/openid-configuration",
  prod:
    "https://api.vipps.no/access-management-1.0/access/.well-known/openid-configuration",
} as const;

type VippsEnv = keyof typeof DISCOVERY_URL;

interface VippsDiscovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
}

let cachedDiscovery: VippsDiscovery | null = null;

const envValue = (name: string) => (process.env[name] || "").trim();

// Only "test" or "prod" is accepted, so a typo can never send production
// keys to the test environment or the other way around.
function env(): VippsEnv | null {
  const v = envValue("VIPPS_MILJO");
  return v === "test" || v === "prod" ? v : null;
}

export const vippsClientId = () => envValue("VIPPS_CLIENT_ID");
export const vippsClientSecret = () => envValue("VIPPS_CLIENT_SECRET");

export function vippsReady(): boolean {
  return Boolean(
    vippsClientId() && vippsClientSecret() && sessionSecretOk() && env()
  );
}

export async function discovery(): Promise<VippsDiscovery> {
  if (cachedDiscovery) return cachedDiscovery;
  const e = env();
  if (!e) throw new Error('VIPPS_MILJO må være "test" eller "prod"');
  const r = await fetch(DISCOVERY_URL[e]);
  if (!r.ok) {
    throw new Error(`fikk ikke hentet Vipps-oppsettet (HTTP ${r.status})`);
  }
  cachedDiscovery = (await r.json()) as VippsDiscovery;
  return cachedDiscovery;
}

// Must match exactly the URL registered on the Vipps sales unit.
// Set VIPPS_REDIRECT_URI to force one specific URL, otherwise the request's
// own host is used so dev/staging/prod domains each work with their own.
export function redirectUri(req: VercelRequest): string {
  const override = envValue("VIPPS_REDIRECT_URI");
  if (override) return override;
  const host = (req.headers["x-forwarded-host"] || req.headers.host) as string;
  return `https://${host}/api/vipps/tilbake`;
}

export function systemHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    "Vipps-System-Name": "eventyrboka",
    "Vipps-System-Version": "0.1.0",
    "Vipps-System-Plugin-Name": "eventyrboka-web",
    "Vipps-System-Plugin-Version": "0.1.0",
  };
  if (envValue("VIPPS_SUBSCRIPTION_KEY")) {
    h["Ocp-Apim-Subscription-Key"] = envValue("VIPPS_SUBSCRIPTION_KEY");
  }
  if (envValue("VIPPS_MSN")) {
    h["Merchant-Serial-Number"] = envValue("VIPPS_MSN");
  }
  return h;
}
