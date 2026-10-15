import type { ScannedToken, ScoreBreakdown } from "./types";

type TokenInput = Omit<ScannedToken, "score" | "scoreBreakdown">;

export function scoreToken(token: TokenInput): {
  score: number;
  scoreBreakdown: ScoreBreakdown;
} {
  const momentum = clamp(
    token.uniqueBuyers1m * 4 +
      token.volume1mSol * 6 +
      Math.max(0, token.change1mPct) * 0.8,
    0,
    35,
  );

  const social =
    (token.hasTwitter ? 8 : 0) +
    (token.hasTelegram ? 7 : 0) +
    (token.hasWebsite ? 5 : 0);

  const holderQuality = clamp(
    25 -
      token.devHoldingPct * 0.45 -
      token.sniperPct * 0.35 +
      Math.min(token.holders, 120) * 0.08,
    0,
    25,
  );

  const riskPenalty = clamp(
    token.devHoldingPct * 0.2 + token.sniperPct * 0.25,
    0,
    20,
  );
  const risk = 20 - riskPenalty;

  // Prefer early curve entries with some traction, not empty or almost graduated
  const curveSweetSpot = 1 - Math.abs(token.bondingProgress - 28) / 40;
  const curve = clamp(curveSweetSpot * 20 + (token.liquiditySol > 8 ? 3 : 0), 0, 20);

  const scoreBreakdown = {
    momentum: round1(momentum),
    social: round1(social),
    holderQuality: round1(holderQuality),
    risk: round1(risk),
    curve: round1(curve),
  };

  const score = round1(
    scoreBreakdown.momentum +
      scoreBreakdown.social +
      scoreBreakdown.holderQuality +
      scoreBreakdown.risk +
      scoreBreakdown.curve,
  );

  return { score, scoreBreakdown };
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}
