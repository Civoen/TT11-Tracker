import { json, deleteMatch } from "../../_lib/matches.js";

export async function onRequestDelete({ params, env }) {
  return deleteMatch(params.id, env);
}

export async function onRequest() {
  return json({ error: "Method not allowed" }, 405);
}
