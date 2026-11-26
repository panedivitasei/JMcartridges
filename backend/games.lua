-- Each game's match, Game Info and place in the list.
local log = require("log")
local sources = require("sources")
local state = require("state")

local M = {}

M.MAX_SHOWN = 10

local function text(v)
  return type(v) == "string" and v or ""
end

local function strings(v)
  local out = {}
  for _, s in ipairs(type(v) == "table" and v or {}) do
    if type(s) == "string" and s:match("%S") and #out < 50 then out[#out + 1] = (s:match("^%s*(.-)%s*$")) end
  end
  return out
end

-- Game Info in the one shape that is stored and sent.
local function clean(info)
  info = type(info) == "table" and info or {}
  local modes = type(info.modes) == "table" and info.modes or {}
  local date = text(info.release_date)
  return {
    title = text(info.title),
    description = text(info.description),
    developers = strings(info.developers),
    publishers = strings(info.publishers),
    franchises = strings(info.franchises),
    genres = strings(info.genres),
    release_date = date:match("^%d%d%d%d%-%d%d%-%d%d$") and date or "",
    modes = { single = modes.single == true or nil, multi = modes.multi == true or nil, coop = modes.coop == true or nil },
  }
end

M.clean = clean

local function same(a, b)
  local function flat(i)
    return table.concat({ i.title, i.description, table.concat(i.developers, ";"), table.concat(i.publishers, ";"), table.concat(i.franchises, ";"),
      table.concat(i.genres, ";"), i.release_date, tostring(i.modes.single), tostring(i.modes.multi), tostring(i.modes.coop) }, "|")
  end
  return flat(a) == flat(b)
end

-- "ready", "none" (no match), "excluded" or "new".
function M.status(rec)
  if not rec then return "new" end
  if rec.state == "excluded" then return "excluded" end
  if rec.match or rec.custom then return "ready" end
  if rec.state == "none" then return "none" end
  return "new"
end

-- The info a game shows: the user's edit, else the match's.
function M.shown(rec)
  return rec and (rec.custom or rec.info) or nil
end

local function row(appid, name, rec)
  local match = rec and rec.match
  return {
    appid = appid,
    name = name,
    status = M.status(rec),
    match = match and { source = match.source, id = match.id, name = match.name } or nil,
    edited = rec ~= nil and rec.custom ~= nil and (rec.info == nil or not same(clean(rec.custom), clean(rec.info))),
  }
end

-- The list: one row per game the frontend names.
function M.list(named)
  local out = {}
  for _, g in ipairs(type(named) == "table" and named or {}) do
    local appid = type(g) == "table" and state.appid(g.appid)
    if appid then out[#out + 1] = row(appid, text(g.name), state.peek(appid)) end
  end
  return out
end

-- Letters and digits only, lower case, single spaces.
function M.plain(s)
  s = tostring(s or ""):gsub("\226\132\162", " "):gsub("\194\174", " "):gsub("\194\169", " "):gsub("\226\128\153", "'")
  return (s:lower():gsub("'", ""):gsub("[%c%p]", " "):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- How close a name is to the typed text: 4 the same, 3 starts with it, 2 has its words, 1 has its letters, 0 neither.
local function closeness(name, typed)
  if name == typed or name:gsub(" ", "") == typed:gsub(" ", "") then return 4 end
  if name:sub(1, #typed) == typed then return 3 end
  local words, letters = true, true
  for word in typed:gmatch("%S+") do
    if not (" " .. name):find(" " .. word, 1, true) then words = false end
    if not name:find(word, 1, true) then letters = false end
  end
  return words and 2 or (letters and 1 or 0)
end

-- Searches the sources a game can be matched from, in the user's order: { results, none, errors }.
function M.search(term, only)
  local typed = M.plain(term)
  local out = { results = {}, none = true, errors = {} }
  if typed == "" then
    out.none = false
    return out
  end
  for _, id in ipairs(sources.order()) do
    if sources.MATCHABLE[id] and sources.in_use(id) and (only == nil or only == id) then
      out.none = false
      local ok, found, err = pcall(sources.get(id).search, term)
      if not ok or not found then
        out.errors[id] = id .. "-" .. (ok and tostring(err or "not-reached") or "not-reached")
      else
        -- Ranked on a copy: the list may be the source's own kept answer.
        local ranked = {}
        for i, r in ipairs(found) do
          ranked[i] = { game = r, close = closeness(M.plain(r.name), typed), weight = tonumber(r.weight) or 0, at = i }
        end
        table.sort(ranked, function(a, b)
          if a.close ~= b.close then return a.close > b.close end
          if a.weight ~= b.weight then return a.weight > b.weight end
          return a.at < b.at
        end)
        for i = 1, math.min(#ranked, M.MAX_SHOWN) do
          local r = ranked[i].game
          out.results[#out.results + 1] = { source = id, id = r.id, name = r.name, year = r.year, platforms = r.platforms or {} }
        end
      end
    end
  end
  return out
end

-- Makes a source's game the match and takes its Game Info; an edit the user made stays on top.
function M.match(appid, source, id)
  local src = sources.MATCHABLE[source] and sources.get(source)
  id = tonumber(id)
  if not src or not id then return { error = "unknown" } end
  local ok, info, err = pcall(src.info, id)
  if not ok or not info then
    log.line("match", string.format("%s: %s game %d not taken (%s)", state.key(appid), source, id, ok and tostring(err) or "error"))
    return { error = source .. "-" .. (ok and tostring(err or "not-reached") or "not-reached") }
  end
  local rec = state.game(appid)
  rec.info = clean(info)
  rec.match = { source = source, id = id, name = rec.info.title }
  rec.state = nil
  state.save()
  log.line("match", string.format("%s: %s game %d", state.key(appid), source, id))
  return { ok = true }
end

-- Takes the match and everything learned from it away; the game is then left as "no match".
function M.unmatch(appid)
  local rec = state.game(appid)
  rec.match, rec.info, rec.custom = nil, nil, nil
  rec.state = "none"
  state.save()
  log.line("match", state.key(appid) .. ": unlinked")
  return { ok = true }
end

-- "excluded", "none" or nil (back in the list as it was).
function M.set_state(appid, value)
  local rec = state.game(appid)
  rec.state = (value == "excluded" or value == "none") and value or nil
  state.save()
  return { ok = true }
end

function M.info(appid)
  local rec = state.peek(appid)
  local shown = M.shown(rec)
  return {
    info = shown and clean(shown) or nil,
    matched = rec and rec.info and clean(rec.info) or nil,
    custom = rec ~= nil and rec.custom ~= nil,
    match = rec and rec.match or nil,
  }
end

function M.save_info(appid, info)
  local next = clean(info)
  if next.title == "" then return { error = "no-title" } end
  local rec = state.game(appid)
  rec.custom = next
  -- A game filled in by hand is in the list again, whatever it was left as.
  rec.state = nil
  state.save()
  return { ok = true }
end

-- Drops the user's edit: the match's info shows again, or none.
function M.reset_info(appid)
  local rec = state.game(appid)
  rec.custom = nil
  state.save()
  return { ok = true }
end

-- Every game's shown info, by appid, for the game pages.
function M.all_info()
  local out = {}
  for key, rec in pairs(state.games()) do
    local shown = type(rec) == "table" and M.shown(rec)
    if shown then out[key] = clean(shown) end
  end
  return out
end

return M
