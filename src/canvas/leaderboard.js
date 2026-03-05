// ─── src/canvas/leaderboard.js ───────────────────────────────────
// Generates a professional leaderboard standings image.

import { createCanvas } from "@napi-rs/canvas";

// ── Color Palette (Discord dark theme) ───────────────────────────
const C = {
  BG: "#1e1f22",
  CARD: "#2b2d31",
  CARD_ALT: "#313338",
  HEADER: "#5865f2",
  HEADER_END: "#4752c4",
  TEXT: "#f2f3f5",
  TEXT_SEC: "#b5bac1",
  TEXT_MUTED: "#6d6f78",
  GREEN: "#57f287",
  RED: "#ed4245",
  YELLOW: "#fee75c",
  GOLD: "#ffd700",
  SILVER: "#c0c0c0",
  BRONZE: "#cd7f32",
  BAR_BG: "#3f4147",
  DIVIDER: "#40444b",
  DQ_OVERLAY: "rgba(237,66,69,0.15)",
};

// ── Layout constants ─────────────────────────────────────────────
const WIDTH = 800;
const PAD = 24;
const CONTENT_W = WIDTH - PAD * 2;
const HEADER_H = 88;
const INFO_H = 32;
const COL_HEAD_H = 36;
const ROW_H = 48;
const ROW_GAP = 3;
const FOOTER_H = 36;

// Column X positions
const COL = {
  rank: PAD + 14,
  name: PAD + 58,
  bar: PAD + 380,
  pts: PAD + 490,
  w: PAD + 555,
  l: PAD + 610,
  d: PAD + 665,
  gp: PAD + 720,
};

// ── Helpers ──────────────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function truncate(ctx, text, maxW) {
  if (!text) return "";
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + "…").width > maxW)
    t = t.slice(0, -1);
  return t + "…";
}

// ═════════════════════════════════════════════════════════════════
//  MAIN EXPORT
// ═════════════════════════════════════════════════════════════════

/**
 * Generate the leaderboard PNG buffer.
 *
 * @param {object}   tournament
 * @param {object[]} leaderboard       Sorted player rows from DB
 * @param {number}   completedMatches
 * @param {number}   totalMatches
 * @returns {Buffer}
 */
export function generateLeaderboardImage(
  tournament,
  leaderboard,
  completedMatches,
  totalMatches,
) {
  const rows = leaderboard.length || 1;
  const height =
    PAD +
    HEADER_H +
    10 +
    INFO_H +
    6 +
    COL_HEAD_H +
    4 +
    rows * (ROW_H + ROW_GAP) +
    10 +
    FOOTER_H +
    PAD;

  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");

  // ── Background ─────────────────────────────────────────────
  ctx.fillStyle = C.BG;
  ctx.fillRect(0, 0, WIDTH, height);

  let y = PAD;

  // ── Header gradient ────────────────────────────────────────
  const grad = ctx.createLinearGradient(PAD, y, PAD + CONTENT_W, y + HEADER_H);
  grad.addColorStop(0, C.HEADER);
  grad.addColorStop(1, C.HEADER_END);
  roundRect(ctx, PAD, y, CONTENT_W, HEADER_H, 12);
  ctx.fillStyle = grad;
  ctx.fill();

  // Title
  ctx.fillStyle = C.TEXT;
  ctx.font = "bold 26px sans-serif";
  ctx.fillText(
    truncate(ctx, tournament.name, CONTENT_W - 60),
    PAD + 24,
    y + 38,
  );

  // Subtitle
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "14px sans-serif";
  ctx.fillText("L E A D E R B O A R D", PAD + 24, y + 62);

  // Accent line
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(PAD + 24, y + 72, 160, 2);

  y += HEADER_H + 10;

  // ── Info bar ───────────────────────────────────────────────
  const pct =
    totalMatches > 0 ? Math.round((completedMatches / totalMatches) * 100) : 0;
  const info = `Round ${tournament.current_round}/${tournament.total_rounds}   •   ${completedMatches}/${totalMatches} Matches (${pct}%)   •   ${leaderboard.length} Players`;
  ctx.fillStyle = C.TEXT_MUTED;
  ctx.font = "13px sans-serif";
  ctx.fillText(info, PAD + 12, y + 20);

  y += INFO_H + 6;

  // ── Column headers ─────────────────────────────────────────
  roundRect(ctx, PAD, y, CONTENT_W, COL_HEAD_H, 8);
  ctx.fillStyle = C.CARD;
  ctx.fill();

  ctx.fillStyle = C.TEXT_MUTED;
  ctx.font = "bold 11px sans-serif";
  ctx.fillText("#", COL.rank + 4, y + 23);
  ctx.fillText("PLAYER", COL.name, y + 23);
  ctx.fillText("POINTS", COL.bar, y + 23);
  ctx.fillText("W", COL.w, y + 23);
  ctx.fillText("L", COL.l, y + 23);
  ctx.fillText("D", COL.d, y + 23);
  ctx.fillText("GP", COL.gp, y + 23);

  y += COL_HEAD_H + 4;

  // ── Player rows ────────────────────────────────────────────
  const maxPts =
    leaderboard.length > 0 ? Math.max(leaderboard[0].points, 1) : 1;
  const rankColor = [C.GOLD, C.SILVER, C.BRONZE];

  for (let i = 0; i < leaderboard.length; i++) {
    const p = leaderboard[i];
    const isDQ = p.status === "disqualified";

    // Row background
    roundRect(ctx, PAD, y, CONTENT_W, ROW_H, 8);
    ctx.fillStyle = i % 2 === 0 ? C.CARD : C.CARD_ALT;
    ctx.fill();

    // DQ overlay
    if (isDQ) {
      roundRect(ctx, PAD, y, CONTENT_W, ROW_H, 8);
      ctx.fillStyle = C.DQ_OVERLAY;
      ctx.fill();
    }

    const cy = y + ROW_H / 2;

    // ── Rank indicator ─────────────────────────────────────
    if (i < 3 && !isDQ) {
      ctx.beginPath();
      ctx.arc(COL.rank + 14, cy, 15, 0, Math.PI * 2);
      ctx.fillStyle = rankColor[i];
      ctx.fill();

      // Inner shadow
      ctx.beginPath();
      ctx.arc(COL.rank + 14, cy, 12, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fill();

      ctx.fillStyle = "#fff";
      ctx.font = "bold 15px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`${i + 1}`, COL.rank + 14, cy + 5);
      ctx.textAlign = "left";
    } else {
      ctx.fillStyle = isDQ ? C.RED : C.TEXT_SEC;
      ctx.font = "bold 15px sans-serif";
      ctx.fillText(isDQ ? "DQ" : `${i + 1}`, COL.rank + 6, cy + 5);
    }

    // ── Player name ────────────────────────────────────────
    ctx.fillStyle = isDQ ? C.TEXT_MUTED : C.TEXT;
    ctx.font = isDQ ? "italic 15px sans-serif" : "bold 15px sans-serif";
    ctx.fillText(
      truncate(ctx, p.display_name || p.username, COL.bar - COL.name - 16),
      COL.name,
      cy + 5,
    );

    // ── Points bar ─────────────────────────────────────────
    const barW = 100;
    const barH = 8;
    const barY = cy - 12;
    const fill = Math.max((p.points / maxPts) * barW, p.points > 0 ? 8 : 0);

    roundRect(ctx, COL.bar, barY, barW, barH, 4);
    ctx.fillStyle = C.BAR_BG;
    ctx.fill();

    if (fill > 0) {
      roundRect(ctx, COL.bar, barY, fill, barH, 4);
      ctx.fillStyle = isDQ ? C.TEXT_MUTED : i < 3 ? rankColor[i] : C.GREEN;
      ctx.fill();
    }

    // Points number
    ctx.fillStyle = isDQ ? C.TEXT_MUTED : C.TEXT;
    ctx.font = "bold 15px sans-serif";
    ctx.fillText(`${p.points}`, COL.pts, cy + 5);

    // ── W / L / D / GP ─────────────────────────────────────
    ctx.font = "14px sans-serif";

    ctx.fillStyle = isDQ ? C.TEXT_MUTED : C.GREEN;
    ctx.fillText(`${p.wins}`, COL.w, cy + 5);

    ctx.fillStyle = isDQ ? C.TEXT_MUTED : C.RED;
    ctx.fillText(`${p.losses}`, COL.l, cy + 5);

    ctx.fillStyle = isDQ ? C.TEXT_MUTED : C.YELLOW;
    ctx.fillText(`${p.draws}`, COL.d, cy + 5);

    ctx.fillStyle = isDQ ? C.TEXT_MUTED : C.TEXT_SEC;
    ctx.fillText(`${p.matches_played}`, COL.gp, cy + 5);

    y += ROW_H + ROW_GAP;
  }

  // Empty state
  if (leaderboard.length === 0) {
    roundRect(ctx, PAD, y, CONTENT_W, ROW_H, 8);
    ctx.fillStyle = C.CARD;
    ctx.fill();
    ctx.fillStyle = C.TEXT_MUTED;
    ctx.font = "italic 14px sans-serif";
    ctx.fillText("No standings available yet.", PAD + 20, y + ROW_H / 2 + 5);
    y += ROW_H + ROW_GAP;
  }

  y += 10;

  // ── Footer ─────────────────────────────────────────────────
  roundRect(ctx, PAD, y, CONTENT_W, FOOTER_H, 8);
  ctx.fillStyle = C.CARD;
  ctx.fill();

  ctx.fillStyle = C.TEXT_MUTED;
  ctx.font = "12px sans-serif";
  const teamLabel = tournament.team_size === 1 ? "Solo" : "Duo";
  ctx.fillText(
    `Round Robin   •   Best of ${tournament.best_of}   •   ${teamLabel}   •   Max ${tournament.max_players} players`,
    PAD + 14,
    y + 23,
  );

  return canvas.toBuffer("image/png");
}
