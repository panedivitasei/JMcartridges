-- TheGamesDB as a source: search, Game Info, box fronts, fan art and clear logos.
local files = require("files")
local keys = require("keys")
local net = require("net")

local M = { id = "thegamesdb", needs = { "thegamesdb_api" } }

M.deps = { now = nil }

-- Answers are kept on disk: the key has a monthly allowance.
M.KEEP_SECONDS = 30 * 86400
M.KEEP_NOTHING_SECONDS = 7 * 86400
M.MAX_GAMES = 4

local API = "https://api.thegamesdb.net/"
local FILE = "tgdb.json"
local cache

local function now()
  return (M.deps.now or os.time)()
end

function M.reset()
  cache = nil
end

local function load()
  if cache then return cache end
  local saved = files.load(FILE, {})
  cache = { pictures = {}, searches = {}, games = {}, names = {} }
  for name in pairs(cache) do
    if type(saved[name]) == "table" then cache[name] = saved[name] end
  end
  for _, kind in ipairs({ "developers", "publishers", "genres" }) do
    if type(cache.names[kind]) ~= "table" then cache.names[kind] = {} end
  end
  return cache
end

local function save()
  files.save(FILE, load())
end

local function fresh(hit, seconds)
  return type(hit) == "table" and now() - (tonumber(hit.at) or 0) < seconds
end

local function plain(title)
  return (tostring(title or ""):lower():gsub("[%c%p]", " "):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", ""))
end

local function list(v)
  return type(v) == "table" and v or {}
end

local function get(query, key)
  return net.decode(net.get("thegamesdb", API .. query .. "apikey=" .. net.encode(key), { ["Accept"] = "application/json" }))
end

function M.check(creds)
  local data, err = get("v1/API/Limit?", creds.thegamesdb_api or "")
  if not data then return err == "key-refused" and false or nil end
  return tonumber(data.remaining_monthly_allowance) ~= nil
end

function M.search(term)
  local name = plain(term)
  if name == "" then return {} end
  local hit = load().searches[name]
  local keep = type(hit) == "table" and type(hit.results) == "table" and #hit.results > 0 and M.KEEP_SECONDS or M.KEEP_NOTHING_SECONDS
  if fresh(hit, keep) and type(hit.results) == "table" then return hit.results end
  local key = keys.get("thegamesdb_api")
  if not key then return nil, "key-refused" end
  local found, err = get("v1.1/Games/ByGameName?name=" .. net.encode(term) .. "&include=platform&", key)
  if not found then return nil, err end
  local platforms = type(found.include) == "table" and type(found.include.platform) == "table" and found.include.platform.data or nil
  local results = {}
  for _, game in ipairs(list(type(found.data) == "table" and found.data.games)) do
    local id = type(game) == "table" and tonumber(game.id)
    if id and type(game.game_title) == "string" and #results < 20 then
      local platform = type(platforms) == "table" and platforms[tostring(game.platform)]
      results[#results + 1] = {
        id = id,
        name = game.game_title,
        year = tonumber(tostring(game.release_date or ""):match("^(%d%d%d%d)")),
        platforms = type(platform) == "table" and type(platform.name) == "string" and { platform.name } or {},
      }
    end
  end
  load().searches[name] = { at = now(), results = results }
  save()
  return results
end

local function numbers(v)
  local out = {}
  for _, n in ipairs(list(v)) do
    if tonumber(n) then out[#out + 1] = tonumber(n) end
  end
  return out
end

-- The names behind developer or publisher ids, asked once and kept; nil when the names could not be asked.
local function names_of(kind, endpoint, ids, key)
  local kept = load().names[kind]
  local missing = {}
  for _, id in ipairs(ids) do
    if kept[tostring(id)] == nil then missing[#missing + 1] = string.format("%d", id) end
  end
  if #missing > 0 then
    local answer = get(endpoint .. "?id=" .. table.concat(missing, ",") .. "&", key)
    if not answer then return nil end
    local got = type(answer.data) == "table" and answer.data[kind]
    for id, entry in pairs(list(got)) do
      if type(entry) == "table" and type(entry.name) == "string" then kept[tostring(id)] = entry.name end
    end
  end
  local out = {}
  for _, id in ipairs(ids) do
    local name = kept[tostring(id)]
    if type(name) == "string" and name ~= "" then out[#out + 1] = name end
  end
  return out
end

function M.info(id)
  local k = string.format("%d", id)
  local hit = load().games[k]
  if fresh(hit, M.KEEP_SECONDS) and type(hit.info) == "table" then return hit.info end
  local key = keys.get("thegamesdb_api")
  if not key then return nil, "key-refused" end
  local found, err = get("v1/Games/ByGameID?id=" .. k .. "&fields=players,publishers,genres,overview&", key)
  if not found then return nil, err end
  local game = list(type(found.data) == "table" and found.data.games)[1]
  if type(game) ~= "table" or type(game.game_title) ~= "string" then return nil, "not-found" end
  local genre_names = load().names.genres
  if next(genre_names) == nil then
    local answer = get("v1/Genres?", key)
    if not answer then return nil, "not-reached" end
    for gid, entry in pairs(list(type(answer.data) == "table" and answer.data.genres)) do
      if type(entry) == "table" and type(entry.name) == "string" then genre_names[tostring(gid)] = entry.name end
    end
  end
  local genres = {}
  for _, gid in ipairs(numbers(game.genres)) do
    if type(genre_names[tostring(gid)]) == "string" then genres[#genres + 1] = genre_names[tostring(gid)] end
  end
  local players = tonumber(game.players)
  local developers = names_of("developers", "v1/Developers/ByDeveloperID", numbers(game.developers), key)
  local publishers = names_of("publishers", "v1/Publishers/ByPublisherID", numbers(game.publishers), key)
  if not developers or not publishers then return nil, "not-reached" end
  local info = {
    title = game.game_title,
    description = type(game.overview) == "string" and game.overview or "",
    developers = developers,
    publishers = publishers,
    genres = genres,
    release_date = tostring(game.release_date or ""):match("^(%d%d%d%d%-%d%d%-%d%d)") or "",
    modes = players and { single = players >= 1 or nil, multi = players > 1 or nil } or {},
  }
  load().games[k] = { at = now(), info = info }
  save()
  return info
end

-- The pictures of some games by id, sorted into slots.
local function pictures_of(ids, key)
  local answer = get("v1/Games/Images?games_id=" .. table.concat(ids, ",") .. "&filter%5Btype%5D=boxart,fanart,clearlogo,screenshot&", key)
  if not answer then return nil end
  local data = type(answer.data) == "table" and answer.data or {}
  local base = type(data.base_url) == "table" and data.base_url or {}
  local original, thumb = base.original, base.thumb or base.small or base.original
  if type(original) ~= "string" then return { portrait = {}, hero = {}, logo = {}, wide = {} } end
  local out, seen = { portrait = {}, hero = {}, logo = {}, wide = {} }, {}
  local function add(slot, image)
    local file = image.filename
    if type(file) ~= "string" or not file:match("^[%w%-%._/]+$") or file:find("..", 1, true) or seen[slot .. file] then return end
    seen[slot .. file] = true
    out[slot][#out[slot] + 1] = { url = original .. file, thumb = (type(thumb) == "string" and thumb or original) .. file }
  end
  for _, wanted in ipairs({ "boxart", "clearlogo", "fanart", "screenshot" }) do
    for _, id in ipairs(ids) do
      for _, image in ipairs(list(list(data.images)[id])) do
        if type(image) == "table" and image.type == wanted then
          if wanted == "boxart" then
            if image.side == "front" then add("portrait", image) end
          elseif wanted == "clearlogo" then
            add("logo", image)
          else
            add("hero", image)
            add("wide", image)
          end
        end
      end
    end
  end
  return out
end

-- The matched game's pictures, or those of the games of that very name.
local function pictures(ref)
  local name = plain(ref.title)
  local memo = ref.id and ("#" .. string.format("%d", ref.id)) or name
  if memo == "" then return { portrait = {}, hero = {}, logo = {}, wide = {} } end
  local hit = load().pictures[memo]
  if fresh(hit, type(hit) == "table" and hit.found and M.KEEP_SECONDS or M.KEEP_NOTHING_SECONDS) and type(hit.slots) == "table" then return hit.slots end
  local key = keys.get("thegamesdb_api")
  if not key then return nil, "key-refused" end
  local ids = {}
  if ref.id then
    ids[1] = string.format("%d", ref.id)
  else
    local found, err = get("v1.1/Games/ByGameName?name=" .. net.encode(ref.title) .. "&", key)
    if not found then return nil, err end
    for _, game in ipairs(list(type(found.data) == "table" and found.data.games)) do
      local id = type(game) == "table" and tonumber(game.id)
      if id and plain(game.game_title) == name and #ids < M.MAX_GAMES then ids[#ids + 1] = string.format("%d", id) end
    end
  end
  local slots = { portrait = {}, hero = {}, logo = {}, wide = {} }
  if #ids > 0 then
    slots = pictures_of(ids, key)
    if not slots then return nil, "not-reached" end
  end
  load().pictures[memo] = { at = now(), found = #ids > 0, slots = slots }
  save()
  return slots
end

-- The matched game's trailer, fan art and screenshots for its page: a list, or nil and a reason; a picture's size is left out when the source does not give it.
function M.media(id)
  local k = string.format("%d", id)
  local key = keys.get("thegamesdb_api")
  if not key then return nil, "key-refused" end
  local details, err = get("v1/Games/ByGameID?id=" .. k .. "&fields=youtube&", key)
  if not details then return nil, err end
  local answer, why = get("v1/Games/Images?games_id=" .. k .. "&filter%5Btype%5D=fanart,screenshot&", key)
  if not answer then return nil, why end
  local out = {}
  local game = list(type(details.data) == "table" and details.data.games)[1]
  local trailer = type(game) == "table" and type(game.youtube) == "string" and game.youtube:match("([%w_%-]+)$")
  if trailer and #trailer >= 8 then out[#out + 1] = { kind = "video", youtube = trailer } end
  local data = type(answer.data) == "table" and answer.data or {}
  local base = type(data.base_url) == "table" and data.base_url or {}
  local original, thumb = base.original, base.medium or base.large or base.original
  for _, wanted in ipairs({ "fanart", "screenshot" }) do
    for _, image in ipairs(list(list(data.images)[k])) do
      local file = type(image) == "table" and image.type == wanted and image.filename
      if type(original) == "string" and type(file) == "string" and file:match("^[%w%-%._/]+$") and not file:find("..", 1, true) then
        local w, h = tostring(image.resolution or ""):match("^%s*(%d+)%s*x%s*(%d+)")
        out[#out + 1] = {
          kind = wanted == "fanart" and "artwork" or "screenshot",
          url = original .. file,
          thumb = (type(thumb) == "string" and thumb or original) .. file,
          width = tonumber(w),
          height = tonumber(h),
        }
      end
    end
  end
  return out
end

function M.art(ref, slot)
  if slot == "icon" then return {} end
  local slots, err = pictures(ref)
  if not slots then return nil, err end
  return list(slots[slot])
end

return M
