-- Each game's RetroAchievements game and its achievements with the player's unlocks, kept on disk.
local files = require("files")
local log = require("log")
local rom = require("rom")
local sources = require("sources")
local state = require("state")
local vdf = require("vdf")

local M = {}

M.SOURCE = "retroachievements"
-- A console's list of games is asked again after this long.
M.LIST_SECONDS = 30 * 86400
-- A game no RetroAchievements game was found for is looked up again after this long.
M.RETRY_SECONDS = 86400
-- A game's unlocks are asked again once this old.
M.FRESH_SECONDS = 60
-- Consoles tried for one game.
M.MAX_CONSOLES = 4

M.deps = { now = nil }

local FILE = "achievements.json"
local cache
local lists = {}

local function now()
  return (M.deps.now or os.time)()
end

function M.reset()
  cache, lists = nil, {}
end

local function all()
  if not cache then
    cache = files.load(FILE, {})
    if type(cache.games) ~= "table" then cache.games = {} end
    if type(cache.roms) ~= "table" then cache.roms = {} end
  end
  return cache
end

local function save()
  files.save(FILE, all())
end

-- Signed in to RetroAchievements, the source on, and achievements wanted.
function M.on()
  return state.prefs().achievements ~= false and sources.in_use(M.SOURCE)
end

-- A console's games, from the copy on disk while it is fresh: the list, or nil and a reason.
local function list(console)
  local held = lists[console]
  if not held then
    held = files.load(string.format("ra-console-%d.json", console), {})
    lists[console] = held
  end
  if type(held.games) == "table" and type(held.at) == "number" and now() - held.at < M.LIST_SECONDS then return held.games end
  local games, err = sources.get(M.SOURCE).list(console)
  if not games then
    -- An old list is better than none while RetroAchievements cannot be reached.
    if type(held.games) == "table" then return held.games end
    return nil, err
  end
  held = { at = now(), games = games }
  lists[console] = held
  files.save(string.format("ra-console-%d.json", console), held)
  return games
end

-- A title as it is compared: letters and digits, lower case, no "the", no tags in brackets.
function M.plain(title)
  local s = tostring(title or ""):gsub("%b()", " "):gsub("%b[]", " "):lower():gsub("&", " and "):gsub("'", ""):gsub("[%c%p]", " ")
  s = (" " .. s .. " "):gsub("%s+", " "):gsub(" the ", " ")
  return (s:gsub("^%s+", ""):gsub("%s+$", ""))
end

-- The ROM's hash, remembered until the file changes.
local function hash_of(path, console)
  local stamp = files.stamp(path)
  if not stamp then return nil end
  local roms = all().roms
  local memo = string.format("%d|%s|%s", console, path, stamp)
  if type(roms[memo]) == "string" then return roms[memo] end
  local ok, hash = pcall(rom.hash, path, console)
  if not ok or type(hash) ~= "string" then return nil end
  roms[memo] = hash
  return hash
end

-- The shortcut's program and options, or nil when Steam's file does not list it.
local function command(appid)
  for _, entry in ipairs(vdf.shortcuts() or {}) do
    if entry.appid == appid then return entry.exe, entry.options end
  end
  return nil
end

-- Looks for the game on RetroAchievements: { id, by } when found, {} when it has none, or nil and a reason when that could not be asked.
local function look(appid, names)
  local exe, options = command(appid)
  local found = exe and rom.find(exe, options)
  if not found then return {} end
  local consoles = rom.consoles(found)
  local failed
  for n = 1, math.min(#consoles, M.MAX_CONSOLES) do
    local console = consoles[n]
    local games, err = list(console)
    if not games then
      failed = failed or err
    else
      if rom.hashable(found, console) then
        local hash = hash_of(found.path, console)
        for _, game in ipairs(hash and games or {}) do
          for _, known in ipairs(game.hashes or {}) do
            if known == hash then return { id = game.id, by = "hash" } end
          end
        end
      end
      for _, name in ipairs(names) do
        local wanted = M.plain(name)
        for _, game in ipairs(wanted ~= "" and games or {}) do
          for _, title in ipairs(game.titles or {}) do
            if M.plain(title) == wanted then return { id = game.id, by = "title" } end
          end
        end
      end
    end
  end
  if failed then return nil, failed end
  return {}
end

-- What marks the shortcut's command, so a changed ROM is looked up again.
local function mark(appid)
  local exe, options = command(appid)
  return tostring(exe or "") .. "|" .. tostring(options or "")
end

local function shape(rec)
  if type(rec) ~= "table" or not tonumber(rec.ra) or type(rec.items) ~= "table" then return { items = {} } end
  return { game = { id = rec.ra, title = rec.title or "", console = rec.console or "", icon = rec.icon or "" }, items = rec.items }
end

-- A game's achievements: { game, items, error }; the list is empty for a game RetroAchievements has none for.
function M.get(appid, name)
  if not M.on() then return { items = {} } end
  local k = state.key(appid)
  local games = all().games
  local rec = type(games[k]) == "table" and games[k] or nil
  local sig = mark(appid)
  local stale = not rec or rec.sig ~= sig or (not tonumber(rec.ra) and now() - (tonumber(rec.looked) or 0) >= M.RETRY_SECONDS)
  if stale then
    -- The matched game's name is tried before the shortcut's own.
    local names = {}
    local held = state.peek(appid)
    local matched = held and held.match and held.match.name
    if type(matched) == "string" and matched:match("%S") then names[#names + 1] = matched end
    if type(name) == "string" and name:match("%S") then names[#names + 1] = name end
    local hit, err = look(appid, names)
    if not hit then
      log.line("achievements", string.format("%s: not looked up (%s)", k, tostring(err)))
      return { items = rec and rec.sig == sig and shape(rec).items or {}, error = err }
    end
    rec = { sig = sig, looked = now(), ra = hit.id, by = hit.by }
    games[k] = rec
    save()
    log.line("achievements", hit.id and string.format("%s: RetroAchievements game %d, by %s", k, hit.id, hit.by) or (k .. ": no RetroAchievements game"))
  end
  if not tonumber(rec.ra) then return { items = {} } end
  if type(rec.items) == "table" and now() - (tonumber(rec.asked) or 0) < M.FRESH_SECONDS then return shape(rec) end
  local got, err = sources.get(M.SOURCE).game(rec.ra)
  if not got then
    log.line("achievements", string.format("%s: not asked (%s)", k, tostring(err)))
    local out = shape(rec)
    out.error = err
    return out
  end
  rec.title, rec.console, rec.icon, rec.items, rec.asked = got.title, got.console, got.icon, got.items, now()
  save()
  local unlocked = 0
  for _, item in ipairs(got.items) do
    if item.unlocked > 0 then unlocked = unlocked + 1 end
  end
  log.line("achievements", string.format("%s: %d of %d unlocked", k, unlocked, #got.items))
  return shape(rec)
end

-- Every game's kept achievements, for the pages to show before anything is asked.
function M.all_kept()
  local out = {}
  if not M.on() then return out end
  for k, rec in pairs(all().games) do
    local one = shape(rec)
    if #one.items > 0 then out[k] = one end
  end
  return out
end

return M
