// Shared logic between the Pages Functions routes in functions/api/matches/.
// Storage model: one match = one R2 object, key `matches/{date}_{matchNumber}.json`
// (e.g. matches/2026-09-16_001.json). The match fields are duplicated onto the
// object's customMetadata, so listing every match is one R2 list() walk that
// reads metadata only — no need to fetch hundreds of individual object bodies.

export const PLAYERS = new Set(["adam", "dave"]);
export const PREFIX = "matches/";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function idFor(playedDate, matchNumber) {
  return `${playedDate}_${String(matchNumber).padStart(3, "0")}`;
}

export function keyFor(id) {
  return `${PREFIX}${id}.json`;
}

export function recordFromMetadata(md) {
  return {
    id: md.id,
    playedDate: md.playedDate,
    dayOfWeek: md.dayOfWeek,
    matchNumber: Number(md.matchNumber),
    game1: md.game1,
    game2: md.game2,
    game3: md.game3 || null,
    winner: md.winner,
    createdAt: md.createdAt,
  };
}

export async function listMatches(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.MATCHES.list({ prefix: PREFIX, cursor, limit: 1000, include: ["customMetadata"] });
    for (const obj of page.objects) {
      if (obj.customMetadata) out.push(recordFromMetadata(obj.customMetadata));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  out.sort((a, b) => a.playedDate.localeCompare(b.playedDate) || a.matchNumber - b.matchNumber);
  return json(out);
}

export async function createMatch(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Body must be JSON" }, 400);
  }

  const { playedDate, dayOfWeek, matchNumber, games, winner } = body ?? {};

  if (
    typeof playedDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(playedDate) ||
    typeof dayOfWeek !== "string" ||
    !Number.isInteger(matchNumber) ||
    matchNumber < 1 ||
    !Array.isArray(games) ||
    games.length < 2 ||
    games.length > 3 ||
    !games.every((g) => PLAYERS.has(g)) ||
    !PLAYERS.has(winner)
  ) {
    return json({ error: "Invalid match payload" }, 400);
  }

  const tally = { adam: 0, dave: 0 };
  for (const g of games) tally[g] += 1;
  const computedWinner = tally.adam > tally.dave ? "adam" : tally.dave > tally.adam ? "dave" : null;
  if (computedWinner !== winner) {
    return json({ error: "Winner does not match the game results" }, 400);
  }

  const [game1, game2, game3 = null] = games;
  const id = idFor(playedDate, matchNumber);
  const key = keyFor(id);

  // Not a real transaction — but two different matches never share a key, so
  // this only matters if both phones log the *same* date+matchNumber at the
  // same instant, which a check-then-write catches in practice.
  const existing = await env.MATCHES.head(key);
  if (existing) {
    return json({ error: "That match number is already logged for this date. Refresh and try again." }, 409);
  }

  const createdAt = new Date().toISOString();
  const record = { id, playedDate, dayOfWeek, matchNumber, game1, game2, game3, winner, createdAt };

  await env.MATCHES.put(key, JSON.stringify(record), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: {
      id,
      playedDate,
      dayOfWeek,
      matchNumber: String(matchNumber),
      game1,
      game2,
      game3: game3 || "",
      winner,
      createdAt,
    },
  });

  return json({ id }, 201);
}

export async function deleteMatch(id, env) {
  const key = keyFor(id);
  const existing = await env.MATCHES.head(key);
  if (!existing) {
    return json({ error: "Match not found" }, 404);
  }
  await env.MATCHES.delete(key);
  return new Response(null, { status: 204 });
}
