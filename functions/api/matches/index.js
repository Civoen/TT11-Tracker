import { json, listMatches, createMatch } from "../../_lib/matches.js";

export async function onRequestGet({ env }) {
  return listMatches(env);
}

export async function onRequestPost({ request, env }) {
  return createMatch(request, env);
}

export async function onRequest({ request }) {
  return json({ error: "Method not allowed" }, 405);
}
