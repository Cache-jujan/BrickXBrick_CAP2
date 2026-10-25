import test from "node:test";
import assert from "node:assert/strict";

import { searchRequests, suggestRequests, words } from "../../request-search.js";

const req = (id, materialType, over = {}) => ({
  ticketID: id,
  materialType,
  subject: materialType,
  vendorName: "Padeena Enterprises",
  projectName: "Consolacion Building",
  createdAt: "2026-10-10T01:00:00Z",
  ...over,
});

test("words are cut like the server does", () => {
  assert.deepEqual(words('GRANITE TILES 60 X 60'), ["granite", "tile", "60", "x", "60"]);
  assert.deepEqual(words("Cement"), ["cement"]);
});

test("suggestions are the requests that share words with the line, best first", () => {
  const open = [req("a", "Cement"), req("b", "Deformed bar 16mm"), req("c", "Deformed bar 12mm")];
  const result = suggestRequests("DEFORMED BAR 16MM 6M", open);
  assert.equal(result.matched, true);
  assert.deepEqual(result.requests.map((r) => r.ticketID), ["b", "c"]);
});

test("a line that shares nothing falls back to every request", () => {
  const open = [req("a", "Cement"), req("b", "Rebar")];
  const result = suggestRequests("DELIVERY FEE", open);
  assert.equal(result.matched, false);
  assert.equal(result.requests.length, 2);
});

test("equal matches are listed oldest first", () => {
  const open = [req("new", "Cement", { createdAt: "2026-10-12T01:00:00Z" }), req("old", "Cement", { createdAt: "2026-10-10T01:00:00Z" })];
  assert.deepEqual(suggestRequests("Portland cement", open).requests.map((r) => r.ticketID), ["old", "new"]);
});

test("search needs every typed word somewhere on the request", () => {
  const open = [req("a", "Cement", { projectName: "Annex" }), req("b", "Cement"), req("c", "Rebar")];
  assert.deepEqual(searchRequests("cement annex", open).map((r) => r.ticketID), ["a"]);
  assert.deepEqual(searchRequests("padeena", open).length, 3);
});

test("search works while typing: part of a word matches, in any letter case", () => {
  const open = [req("a", "CEMENT", { projectName: "Consolacion Annex" }), req("b", "Deformed bar 16mm")];
  assert.deepEqual(searchRequests("cem", open).map((r) => r.ticketID), ["a"]);
  assert.deepEqual(searchRequests("CEM", open).map((r) => r.ticketID), ["a"]);
  assert.deepEqual(searchRequests("Bar 16", open).map((r) => r.ticketID), ["b"]);
  assert.deepEqual(searchRequests("anne", open).map((r) => r.ticketID), ["a"]);
  assert.deepEqual(searchRequests("zzz", open), []);
});

test("an empty search keeps the whole list; bad input gives nothing", () => {
  const open = [req("a", "Cement")];
  assert.equal(searchRequests("  ", open).length, 1);
  assert.deepEqual(searchRequests("x", undefined), []);
  assert.deepEqual(suggestRequests("x", undefined).requests, []);
});

test("suggestions and search can read the name and text from another shape (the Review picker)", () => {
  const items = [{ key: "a", name: "Cement", projectName: "Annex" }, { key: "b", name: "Deformed bar 16mm", projectName: "Building" }];
  assert.deepEqual(suggestRequests("deformed bar", items, (m) => m.name).requests.map((m) => m.key), ["b"]);
  assert.deepEqual(searchRequests("annex", items, (m) => `${m.name} ${m.projectName}`).map((m) => m.key), ["a"]);
});
