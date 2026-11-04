// Vipps sends the user here after sign-in. We validate the ID token, pull
// the given name, and set the long-lived signed session cookie.
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildCookie,
  openCookie,
  readCookie,
  redirect,
  sealCookie,
} from "../_lib/session.js";
import { recordLogin } from "../_lib/supabase.js";
import {
  discovery,
  redirectUri,
  systemHeaders,
  vippsClientId,
  vippsClientSecret,
} from "../_lib/vipps.js";

const THIRTY_DAYS = 30 * 24 * 60 * 60;

// Only access_denied actually means the user cancelled. Every other error
// code — documented or not — is surfaced as a generic failure.
const ERROR_LABEL: Record<string, string> = {
  access_denied: "avbrutt",
  outdated_app_version: "oppdater",
};

interface VippsAttempt {
  state: string;
  nonce: string;
  verifier: string;
}

interface IdTokenClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nonce?: string;
  sub?: string;
}

interface VippsUserInfo {
  given_name?: string;
  name?: string;
}

function tokenApplies(aud: IdTokenClaims["aud"]): boolean {
  const id = vippsClientId();
  return Array.isArray(aud) ? aud.includes(id) : aud === id;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  const clearAttempt = buildCookie("eventyrboka_vipps", "", 0);
  try {
    const url = new URL(req.url || "/", "https://eventyrboka.invalid");
    const errorCode = url.searchParams.get("error");
    if (errorCode) {
      console.error(
        "Vipps sendte en feil tilbake:",
        errorCode,
        url.searchParams.get("error_description") || ""
      );
      res.setHeader("Set-Cookie", clearAttempt);
      return redirect(res, `/?vipps=${ERROR_LABEL[errorCode] || "feil"}`);
    }

    const attempt = openCookie<VippsAttempt>(
      "vipps",
      readCookie(req, "eventyrboka_vipps")
    );
    const code = url.searchParams.get("code");
    if (
      !attempt ||
      !code ||
      url.searchParams.get("state") !== attempt.state
    ) {
      throw new Error("state stemmer ikke");
    }

    const cfg = await discovery();
    const basic = Buffer.from(
      `${vippsClientId()}:${vippsClientSecret()}`
    ).toString("base64");
    const tokenRes = await fetch(cfg.token_endpoint, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...systemHeaders(),
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri(req),
        code_verifier: attempt.verifier,
      }),
    });
    if (!tokenRes.ok) {
      throw new Error(
        `token-kallet feilet (HTTP ${tokenRes.status}): ${(
          await tokenRes.text()
        ).slice(0, 300)}`
      );
    }
    const token = (await tokenRes.json()) as {
      id_token: string;
      access_token: string;
    };

    // ID token travels directly from Vipps over TLS with client auth, so we
    // inspect the claims without verifying the signature (OpenID Connect
    // Core 3.1.3.7 — "the ID Token has been received via a secure channel").
    const claims = JSON.parse(
      Buffer.from(token.id_token.split(".")[1], "base64url").toString("utf8")
    ) as IdTokenClaims;
    if (claims.iss !== cfg.issuer) throw new Error("feil utsteder i ID-tokenet");
    if (!tokenApplies(claims.aud)) {
      throw new Error("ID-tokenet er ikke laget for oss");
    }
    if (!(claims.exp && claims.exp > Math.floor(Date.now() / 1000))) {
      throw new Error("ID-tokenet er utløpt");
    }
    if (claims.nonce !== attempt.nonce) throw new Error("nonce stemmer ikke");
    if (typeof claims.sub !== "string" || !claims.sub) {
      throw new Error("ID-tokenet mangler sub");
    }

    let fornavn = "";
    const infoRes = await fetch(cfg.userinfo_endpoint, {
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        ...systemHeaders(),
      },
    });
    if (infoRes.ok) {
      const info = (await infoRes.json()) as VippsUserInfo;
      // Vipps sends the full name. We keep only the first given name — what
      // the UI greets the user with — and drop the rest.
      fornavn = String(info.given_name || info.name || "")
        .trim()
        .split(/\s+/)[0]
        .slice(0, 60);
    } else {
      console.error(
        `Vipps userinfo feilet (HTTP ${infoRes.status}):`,
        (await infoRes.text()).slice(0, 200)
      );
    }

    res.setHeader("Set-Cookie", [
      clearAttempt,
      buildCookie(
        "eventyrboka_okt",
        sealCookie("session", { sub: claims.sub, fornavn }, THIRTY_DAYS),
        THIRTY_DAYS
      ),
    ]);
    // Supabase bookkeeping is best-effort — it must never block the login.
    await recordLogin(claims.sub, fornavn);
    redirect(res, "/?vipps=ok");
  } catch (err) {
    console.error("Vipps-innlogging feilet:", (err as Error).message);
    res.setHeader("Set-Cookie", clearAttempt);
    redirect(res, "/?vipps=feil");
  }
}
