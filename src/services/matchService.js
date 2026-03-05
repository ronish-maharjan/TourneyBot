// ─── src/services/matchService.js ────────────────────────────────
// Match scheduling: round-robin generation and utilities.

/**
 * Fisher-Yates shuffle (in-place on a copy).
 * @param {any[]} arr
 * @returns {any[]}
 */
function shuffleArray(arr) {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Generate a full round-robin schedule using the "circle method".
 *
 * - Fix one player, rotate the rest through positions.
 * - If odd number of players, a BYE (null) is inserted;
 *   matchups against the BYE are skipped.
 *
 * @param {string[]} playerIds  Array of Discord user IDs.
 * @param {boolean}  shuffle    Randomise player order first (default true).
 * @returns {{ totalRounds: number, matches: object[] }}
 */
export function generateRoundRobinSchedule(playerIds, shuffle = true) {
  const players = shuffle ? shuffleArray(playerIds) : [...playerIds];
  const isOdd = players.length % 2 !== 0;

  if (isOdd) {
    players.push(null); // BYE placeholder
  }

  const n = players.length;
  const totalRounds = n - 1;
  const halfSize = n / 2;

  const fixed = players[0];
  const rotating = players.slice(1);

  const schedule = [];
  let matchNumber = 1;

  for (let round = 0; round < totalRounds; round++) {
    // ── First pair: fixed vs last in rotating ────────────────
    const opponent = rotating[rotating.length - 1];
    if (fixed !== null && opponent !== null) {
      schedule.push({
        round: round + 1,
        matchNumber: matchNumber++,
        player1Id: fixed,
        player2Id: opponent,
      });
    }

    // ── Remaining pairs ──────────────────────────────────────
    for (let i = 0; i < halfSize - 1; i++) {
      const p1 = rotating[i];
      const p2 = rotating[rotating.length - 2 - i];
      if (p1 !== null && p2 !== null) {
        schedule.push({
          round: round + 1,
          matchNumber: matchNumber++,
          player1Id: p1,
          player2Id: p2,
        });
      }
    }

    // ── Rotate: move last element to front ───────────────────
    rotating.unshift(rotating.pop());
  }

  return { totalRounds, matches: schedule };
}
