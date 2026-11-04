// Sends the user to Vipps to log in. We only ask for the name (scope "openid name").
import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  buildCookie,
  codeChallenge,
  randomToken,
  redirect,
  sealCookie,
} from "../_lib/session.js";
import {
  discovery,
  redirectUri,
  vippsClientId,
  vippsReady,
} from "../_lib/vipps.js";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (!vippsReady()) return redirect(res, "/?vipps=ikke-klar");
  try {
    const cfg = await discovery();
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken();
    const url = new URL(cfg.authorization_endpoint);
    url.search = new URLSearchParams({
      client_id: vippsClientId(),
      response_type: "code",
      scope: "openid name",
      state,
      nonce,
      code_challenge: codeChallenge(verifier),
      code_challenge_method: "S256",
      redirect_uri: redirectUri(req),
    }).toString();
    res.setHeader(
      "Set-Cookie",
      buildCookie(
        "eventyrboka_vipps",
        sealCookie("vipps", { state, nonce, verifier }, 600),
        600
      )
    );
    redirect(res, url.toString());
  } catch (err) {
    console.error("Vipps-innlogging kunne ikke starte:", (err as Error).message);
    redirect(res, "/?vipps=feil");
  }
}
