// ─── src/canvas/bracket.js ───────────────────────────────────────
// Generates a professional round-robin match bracket image.
// Rounds displayed as rows, match cards within each row.

import { createCanvas } from "@napi-rs/canvas";

// ── Color Palette ────────────────────────────────────────────────
const C = {
  BG: "#1e1f22",
  CARD: "#2b2d31",
  CARD_BORDER: "#3f4147",
  HEADER: "#5865f2",
  HEADER_END: "#4752c4",
  TEXT: "#f2f3f5",
  TEXT_SEC: "#b5bac1",
  TEXT_MUTED: "#6d6f78",
  GREEN: "#57f287",
  RED: "#ed4245",
  YELLOW: "#fee75c",
  GOLD: "#ffd700",
  WINNER_BG: "rgba(87,242,135,0.1)",
  PENDING_BAR: "#4e5058",
  LIVE_BAR: "#fee75c",
  DONE_BAR: "#57f287",
  CANCEL_BAR: "#ed4245",
  ROUND_BG: "#313338",
  DIVIDER: "#40444b",
};

// ── Layout ───────────────────────────────────────────────────────
const PAD = 24;
const HEADER_H = 80;
const ROUND_HEADER_H = 32;
const ROUND_GAP = 16;
const CARD_W = 200;
const CARD_H = 88;
const CARD_GAP_X = 14;
const CARD_GAP_Y = 10;
const STATUS_BAR_W = 4;
const MIN_WIDTH = 500;

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
  if (!text) return "???";
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + "…").width > maxW)
    t = t.slice(0, -1);
  return t + "…";
}

function statusColor(status) {
  switch (status) {
    case "completed":
      return C.DONE_BAR;
    case "in_progress":
      return C.LIVE_BAR;
    case "cancelled":
      return C.CANCEL_BAR;
    default:
      return C.PENDING_BAR;
  }
}

function statusLabel(status) {
  switch (status) {
    case "completed":
      return "COMPLETE";
    case "in_progress":
      return "LIVE";
    case "cancelled":
      return "CANCELLED";
    default:
      return "PENDING";
  }
}

// ═════════════════════════════════════════════════════════════════
//  MAIN EXPORT
// ═════════════════════════════════════════════════════════════════

/**
 * Generate the bracket PNG buffer.
 *
 * @param {object}             tournament
 * @param {Map<number,object[]>} matchesByRound  round → match[]
 * @param {Map<string,object>}   participantMap  userId → { display_name, username }
 * @returns {Buffer}
 */
export function generateBracketImage(
  tournament,
  matchesByRound,
  participantMap,
) {
  const roundNumbers = Object.keys(matchesByRound)
    .map(Number)
    .sort((a, b) => a - b);

  if (roundNumbers.length === 0) {
    return generateEmptyBracket(tournament);
  }

  // ── Calculate dimensions ───────────────────────────────────
  const maxMatchesInRound = Math.max(
    ...roundNumbers.map((r) => matchesByRound[r].length),
  );
  const cardsPerRow = maxMatchesInRound;
  const contentWidth = cardsPerRow * (CARD_W + CARD_GAP_X) - CARD_GAP_X;
  const canvasWidth = Math.max(MIN_WIDTH, contentWidth + PAD * 2);

  let canvasHeight = PAD + HEADER_H + 12;
  for (const r of roundNumbers) {
    const matchCount = matchesByRound[r].length;
    const rowsNeeded = Math.ceil(matchCount / cardsPerRow);
    canvasHeight +=
      ROUND_HEADER_H + 8 + rowsNeeded * (CARD_H + CARD_GAP_Y) + ROUND_GAP;
  }
  canvasHeight += PAD;

  const canvas = createCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext("2d");

  // ── Background ─────────────────────────────────────────────
  ctx.fillStyle = C.BG;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  let y = PAD;

  // ── Header ─────────────────────────────────────────────────
  const grad = ctx.createLinearGradient(
    PAD,
    y,
    canvasWidth - PAD,
    y + HEADER_H,
  );
  grad.addColorStop(0, C.HEADER);
  grad.addColorStop(1, C.HEADER_END);
  roundRect(ctx, PAD, y, canvasWidth - PAD * 2, HEADER_H, 12);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = C.TEXT;
  ctx.font = "bold 24px sans-serif";
  ctx.fillText(
    truncate(ctx, tournament.name, canvasWidth - PAD * 2 - 60),
    PAD + 22,
    y + 34,
  );

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "13px sans-serif";
  const teamLabel = tournament.team_size === 1 ? "Solo" : "Duo";
  const totalM = Object.values(matchesByRound).flat().length;
  const completedM = Object.values(matchesByRound)
    .flat()
    .filter((m) => m.status === "completed").length;
  const headerInfo = `M A T C H   B R A C K E T   •   ${teamLabel}   •   Best of ${tournament.best_of}   •   ${completedM}/${totalM} Matches`;
  ctx.fillText(headerInfo, PAD + 22, y + 56);

  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(PAD + 22, y + 66, 200, 2);

  y += HEADER_H + 12;

  // ── Rounds ─────────────────────────────────────────────────
  for (const roundNum of roundNumbers) {
    const matches = matchesByRound[roundNum];
    const roundDone = matches.every(
      (m) => m.status === "completed" || m.status === "cancelled",
    );
    const roundLive = matches.some((m) => m.status === "in_progress");

    // Round header bar
    roundRect(ctx, PAD, y, canvasWidth - PAD * 2, ROUND_HEADER_H, 8);
    ctx.fillStyle = C.ROUND_BG;
    ctx.fill();

    // Round indicator dot
    const dotColor = roundDone ? C.GREEN : roundLive ? C.YELLOW : C.PENDING_BAR;
    ctx.beginPath();
    ctx.arc(PAD + 18, y + ROUND_HEADER_H / 2, 5, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    ctx.fillStyle = C.TEXT;
    ctx.font = "bold 13px sans-serif";
    ctx.fillText(`ROUND ${roundNum}`, PAD + 32, y + 21);

    // Round stats
    const roundCompleted = matches.filter(
      (m) => m.status === "completed",
    ).length;
    ctx.fillStyle = C.TEXT_MUTED;
    ctx.font = "12px sans-serif";
    ctx.fillText(
      `${roundCompleted}/${matches.length} complete`,
      PAD + 120,
      y + 21,
    );

    y += ROUND_HEADER_H + 8;

    // Match cards in this round
    const maxCols = Math.max(
      1,
      Math.floor((canvasWidth - PAD * 2 + CARD_GAP_X) / (CARD_W + CARD_GAP_X)),
    );

    for (let i = 0; i < matches.length; i++) {
      const col = i % maxCols;
      const row = Math.floor(i / maxCols);
      const cx = PAD + col * (CARD_W + CARD_GAP_X);
      const cy = y + row * (CARD_H + CARD_GAP_Y);

      drawMatchCard(ctx, cx, cy, matches[i], tournament, participantMap);
    }

    const rowsNeeded = Math.ceil(matches.length / maxCols);
    y += rowsNeeded * (CARD_H + CARD_GAP_Y) + ROUND_GAP;
  }

  return canvas.toBuffer("image/png");
}

// ═════════════════════════════════════════════════════════════════
//  MATCH CARD RENDERER
// ═════════════════════════════════════════════════════════════════

function drawMatchCard(ctx, x, y, match, tournament, participantMap) {
  const status = match.status;
  const barColor = statusColor(status);
  const isDone = status === "completed";
  const isCancelled = status === "cancelled";

  // ── Card background ──────────────────────────────────────
  roundRect(ctx, x, y, CARD_W, CARD_H, 8);
  ctx.fillStyle = C.CARD;
  ctx.fill();

  // ── Card border ──────────────────────────────────────────
  roundRect(ctx, x, y, CARD_W, CARD_H, 8);
  ctx.strokeStyle = C.CARD_BORDER;
  ctx.lineWidth = 1;
  ctx.stroke();

  // ── Status bar (left edge) ───────────────────────────────
  roundRect(ctx, x, y, STATUS_BAR_W + 4, CARD_H, 8);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = barColor;
  ctx.fillRect(x, y, STATUS_BAR_W + 4, CARD_H);
  ctx.restore();

  // ── Player names & scores ────────────────────────────────
  const p1 = participantMap.get(match.player1_id);
  const p2 = participantMap.get(match.player2_id);
  const p1Name = p1?.display_name || p1?.username || "TBD";
  const p2Name = p2?.display_name || p2?.username || "TBD";

  const nameMaxW = CARD_W - 65;
  const nameX = x + STATUS_BAR_W + 14;
  const scoreX = x + CARD_W - 24;

  // Player 1
  const p1IsWinner = isDone && match.winner_id === match.player1_id;
  const p1IsLoser = isDone && match.loser_id === match.player1_id;

  if (p1IsWinner) {
    // Subtle winner highlight
    ctx.fillStyle = C.WINNER_BG;
    ctx.fillRect(
      x + STATUS_BAR_W + 4,
      y + 2,
      CARD_W - STATUS_BAR_W - 8,
      CARD_H / 2 - 4,
    );
  }

  ctx.fillStyle = p1IsLoser || isCancelled ? C.TEXT_MUTED : C.TEXT;
  ctx.font = p1IsWinner ? "bold 14px sans-serif" : "14px sans-serif";
  ctx.fillText(truncate(ctx, p1Name, nameMaxW), nameX, y + 26);

  // P1 score
  ctx.textAlign = "right";
  ctx.fillStyle = p1IsWinner ? C.GREEN : p1IsLoser ? C.TEXT_MUTED : C.TEXT_SEC;
  ctx.font = "bold 14px sans-serif";
  const p1Score =
    isDone || status === "in_progress" ? `${match.player1_score}` : "-";
  ctx.fillText(p1Score, scoreX, y + 26);
  ctx.textAlign = "left";

  // Divider line
  ctx.fillStyle = C.DIVIDER;
  ctx.fillRect(nameX, y + CARD_H / 2 - 1, CARD_W - STATUS_BAR_W - 32, 1);

  // Player 2
  const p2IsWinner = isDone && match.winner_id === match.player2_id;
  const p2IsLoser = isDone && match.loser_id === match.player2_id;

  if (p2IsWinner) {
    ctx.fillStyle = C.WINNER_BG;
    ctx.fillRect(
      x + STATUS_BAR_W + 4,
      y + CARD_H / 2 + 2,
      CARD_W - STATUS_BAR_W - 8,
      CARD_H / 2 - 6,
    );
  }

  ctx.fillStyle = p2IsLoser || isCancelled ? C.TEXT_MUTED : C.TEXT;
  ctx.font = p2IsWinner ? "bold 14px sans-serif" : "14px sans-serif";
  ctx.fillText(truncate(ctx, p2Name, nameMaxW), nameX, y + 56);

  // P2 score
  ctx.textAlign = "right";
  ctx.fillStyle = p2IsWinner ? C.GREEN : p2IsLoser ? C.TEXT_MUTED : C.TEXT_SEC;
  ctx.font = "bold 14px sans-serif";
  const p2Score =
    isDone || status === "in_progress" ? `${match.player2_score}` : "-";
  ctx.fillText(p2Score, scoreX, y + 56);
  ctx.textAlign = "left";

  // ── Status label (bottom-right) ──────────────────────────
  ctx.textAlign = "right";
  ctx.fillStyle = barColor;
  ctx.font = "bold 9px sans-serif";
  ctx.fillText(statusLabel(status), scoreX, y + CARD_H - 8);
  ctx.textAlign = "left";

  // ── Match number (bottom-left) ───────────────────────────
  ctx.fillStyle = C.TEXT_MUTED;
  ctx.font = "9px sans-serif";
  ctx.fillText(`#${match.match_number}`, nameX, y + CARD_H - 8);
}

// ═════════════════════════════════════════════════════════════════
//  EMPTY BRACKET (before tournament starts)
// ═════════════════════════════════════════════════════════════════

function generateEmptyBracket(tournament) {
  const canvas = createCanvas(MIN_WIDTH, 200);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = C.BG;
  ctx.fillRect(0, 0, MIN_WIDTH, 200);

  // Header
  const grad = ctx.createLinearGradient(
    PAD,
    PAD,
    MIN_WIDTH - PAD,
    PAD + HEADER_H,
  );
  grad.addColorStop(0, C.HEADER);
  grad.addColorStop(1, C.HEADER_END);
  roundRect(ctx, PAD, PAD, MIN_WIDTH - PAD * 2, HEADER_H, 12);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = C.TEXT;
  ctx.font = "bold 22px sans-serif";
  ctx.fillText(
    truncate(ctx, tournament.name, MIN_WIDTH - 100),
    PAD + 22,
    PAD + 34,
  );

  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.font = "13px sans-serif";
  ctx.fillText("M A T C H   B R A C K E T", PAD + 22, PAD + 56);

  // Empty state
  roundRect(ctx, PAD, PAD + HEADER_H + 12, MIN_WIDTH - PAD * 2, 50, 8);
  ctx.fillStyle = C.CARD;
  ctx.fill();

  ctx.fillStyle = C.TEXT_MUTED;
  ctx.font = "italic 14px sans-serif";
  ctx.fillText(
    "Bracket will appear once the tournament starts.",
    PAD + 16,
    PAD + HEADER_H + 42,
  );

  return canvas.toBuffer("image/png");
}
