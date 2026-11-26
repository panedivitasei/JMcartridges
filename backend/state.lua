-- The user's choices (prefs.json) and what is known about each game (games.json).
local files = require("files")

local M = {}

local PREFS = { theme = "dark", source_order = "", off = {}, media_off = {}, show_info = true, achievements = true, desc_limit = 360, opened = false }

local prefs, games

function M.reset()
  prefs, games = nil, nil
end

function M.prefs()
  if not prefs then
    local saved = files.load("prefs.json", {})
    prefs = {}
    for name, default in pairs(PREFS) do
      local v = saved[name]
      if type(v) == type(default) then prefs[name] = v elseif type(default) == "table" then prefs[name] = {} else prefs[name] = default end
    end
  end
  return prefs
end

-- Changes the named choices; unknown names and wrong types are left out.
function M.set_prefs(change)
  local now = M.prefs()
  for name, default in pairs(PREFS) do
    local v = type(change) == "table" and change[name]
    if v ~= nil and type(v) == type(default) then now[name] = v end
  end
  files.save("prefs.json", now)
  return now
end

-- A shortcut's appid as an unsigned number, or nil for anything else.
function M.appid(value)
  local n = tonumber(value)
  if not n then return nil end
  if n < 0 then n = n + 0x100000000 end
  if n < 0x80000000 or n > 0xFFFFFFFF or n ~= math.floor(n) then return nil end
  return n
end

local function key(appid)
  local n = M.appid(appid)
  if not n then error("not a non-Steam game: " .. tostring(appid), 0) end
  return string.format("%d", n)
end

M.key = key

local function all()
  if not games then games = files.load("games.json", {}) end
  return games
end

-- A game's record, made empty when there is none; call save after changing it.
function M.game(appid)
  local list, k = all(), key(appid)
  if type(list[k]) ~= "table" then list[k] = {} end
  return list[k]
end

-- A game's record without making one.
function M.peek(appid)
  local rec = all()[key(appid)]
  return type(rec) == "table" and rec or nil
end

function M.games()
  return all()
end

function M.save()
  -- An empty record is dropped so the file holds only games something is known about.
  for k, rec in pairs(all()) do
    if type(rec) ~= "table" or next(rec) == nil then games[k] = nil end
  end
  return files.save("games.json", games)
end

return M
