-- The trailers, artwork and screenshots a game's page shows under Game Info, from every source chosen for it, kept on disk.
local files = require("files")
local games = require("games")
local log = require("log")
local sources = require("sources")
local state = require("state")

local M = {}

M.KEEP_SECONDS = 30 * 86400
M.MAX_ITEMS = 60
M.MAX_PER_KIND = 12

M.deps = { now = nil }

local FILE = "media.json"
local KINDS = { "video", "artwork", "screenshot" }
local cache

local function now()
  return (M.deps.now or os.time)()
end

function M.reset()
  cache = nil
end

local function all()
  if not cache then cache = files.load(FILE, {}) end
  return cache
end

-- Is the source one whose media the user wants on the pages.
function M.wanted(id)
  return sources.wants(id, "media")
end

function M.set_source(id, on)
  sources.set_part(id, "media", on)
end

-- The sources that give media now, in the user's order.
local function giving()
  local out = {}
  for _, id in ipairs(sources.order()) do
    local src = sources.get(id)
    if sources.gives(id, "media") and type(src.media) == "function" then out[#out + 1] = id end
  end
  return out
end

-- The sources asked for a game's media, and for a purchased game how Steam's own feed joins them.
-- A purchased game already has Steam's community feed, which stands for the Steam source: "first" leaves the page to it,
-- "after" puts the sources above Steam before it, "off" shows the plugin's sources alone.
local function plan(appid)
  local rec = state.peek(appid)
  local list = giving()
  if not (rec and type(rec.steam) == "table") then return list, nil end
  local ask, native = {}, "off"
  for _, id in ipairs(list) do
    if id == "steam" then
      native = #ask == 0 and "first" or "after"
      break
    end
    ask[#ask + 1] = id
  end
  if native == "first" then ask = {} end
  return ask, native
end

local function match_of(appid)
  local rec = state.peek(appid)
  return rec and rec.match or nil
end

-- What a kept answer belongs to: the game's match, the sources asked, and how Steam's own feed joins.
local function mark(appid, match)
  local ask, native = plan(appid)
  return match.source .. ":" .. tostring(match.id) .. "|" .. table.concat(ask, ",") .. (native and ("|" .. native) or "")
end

-- One item in the shape that is kept and sent; nil for anything that cannot be shown.
local function clean(item, source)
  if type(item) ~= "table" then return nil end
  if item.kind == "video" then
    if type(item.youtube) ~= "string" or not item.youtube:match("^[%w_%-]+$") then return nil end
    return { kind = "video", youtube = item.youtube, source = source }
  end
  if item.kind ~= "artwork" and item.kind ~= "screenshot" then return nil end
  if type(item.url) ~= "string" or not item.url:match("^https://") then return nil end
  local w, h = tonumber(item.width), tonumber(item.height)
  return {
    kind = item.kind,
    url = item.url,
    thumb = type(item.thumb) == "string" and item.thumb:match("^https://") and item.thumb or item.url,
    width = w and w > 0 and w or nil,
    height = h and h > 0 and h or nil,
    source = source,
  }
end

-- The game's id at a source: its match there, else the source's game of the very same name; nil for none, false and a reason when the source did not answer.
local function id_at(id, match)
  if id == match.source then return match.id end
  local name = games.plain(match.name)
  if name == "" then return nil end
  local found, err = sources.get(id).search(match.name)
  if not found then return false, err end
  for _, game in ipairs(found) do
    if type(game) == "table" and games.plain(game.name) == name then return game.id end
  end
  return nil
end

local function kept(appid)
  local match = match_of(appid)
  local entry = all()[state.key(appid)]
  if not match or type(entry) ~= "table" or entry.match ~= mark(appid, match) then return nil end
  return entry
end

-- A matched game's items: kept ones while they are fresh, else asked of each chosen source; { items, error }.
function M.get(appid)
  local match = match_of(appid)
  if not match then return { items = {} } end
  local ask, native = plan(appid)
  -- Steam's own feed comes first for this purchased game: nothing is asked and its page is left alone.
  if native == "first" then return { items = {}, native = native } end
  local entry = kept(appid)
  if entry and now() - (tonumber(entry.at) or 0) < M.KEEP_SECONDS then return { items = entry.items or {}, native = native } end
  local by_kind, failed, counts = { video = {}, artwork = {}, screenshot = {} }, nil, {}
  for _, id in ipairs(ask) do
    local ok, game, why = pcall(id_at, id, match)
    local found, err
    if ok and game then
      ok, found, err = pcall(sources.get(id).media, game)
      why = err
    end
    if not ok or game == false or (game and not found) then
      failed = failed or (id .. "-" .. (ok and tostring(why or "not-reached") or "not-reached"))
    elseif found then
      local taken = { video = 0, artwork = 0, screenshot = 0 }
      for _, item in ipairs(found) do
        local one = clean(item, id)
        if one and taken[one.kind] < M.MAX_PER_KIND then
          taken[one.kind] = taken[one.kind] + 1
          table.insert(by_kind[one.kind], one)
        end
      end
      counts[#counts + 1] = id .. " " .. (taken.video + taken.artwork + taken.screenshot)
    end
  end
  -- Trailers first, then artwork, then screenshots, each in the order of the sources.
  local items = {}
  for _, kind in ipairs(KINDS) do
    for _, one in ipairs(by_kind[kind]) do
      if #items < M.MAX_ITEMS then items[#items + 1] = one end
    end
  end
  log.line("media", string.format("%s: %d item(s) (%s)%s", state.key(appid), #items, table.concat(counts, ", "), failed and (", " .. failed) or ""))
  -- An answer with a source missing is shown but not kept, so the source is asked again.
  if failed then return { items = items, error = failed, native = native } end
  all()[state.key(appid)] = { match = mark(appid, match), at = now(), items = items }
  files.save(FILE, all())
  return { items = items, native = native }
end

-- Keeps the sizes the page measured, one { width, height } per kept item in order, for the pictures that had none.
function M.sized(appid, sizes)
  local entry = kept(appid)
  if not entry or type(entry.items) ~= "table" or type(sizes) ~= "table" then return { ok = false } end
  local changed = false
  for i, item in ipairs(entry.items) do
    local pair = sizes[i]
    local w, h = type(pair) == "table" and tonumber(pair[1]), type(pair) == "table" and tonumber(pair[2])
    if item.kind ~= "video" and not (item.width and item.height) and w and h and w > 0 and h > 0 and w < 100000 and h < 100000 then
      item.width, item.height = math.floor(w), math.floor(h)
      changed = true
    end
  end
  if changed then files.save(FILE, all()) end
  return { ok = true }
end

-- Every game's kept items, by appid, without asking anyone: for the pages when Steam starts.
function M.all_kept()
  local out = {}
  for key in pairs(all()) do
    local appid = state.appid(key)
    local entry = appid and kept(appid)
    -- A purchased game's items are asked for when its page is shown, with how Steam's own feed joins them.
    local purchased = appid and state.steam_appid(appid) ~= nil
    if entry and not purchased and type(entry.items) == "table" and #entry.items > 0 then out[key] = entry.items end
  end
  return out
end

return M
