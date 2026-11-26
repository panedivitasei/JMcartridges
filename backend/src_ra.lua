-- RetroAchievements: the games it has achievements for, and a player's progress in one.
local keys = require("keys")
local net = require("net")

local M = { id = "retroachievements", needs = { "ra_user", "ra_api" } }

local API = "https://retroachievements.org/API/"
local MEDIA = "https://media.retroachievements.org"

-- One request: the answer as a table, or nil and "key-refused", "not-found" or "not-reached".
local function get(name, query, key)
  local res, err = net.get("retroachievements", API .. name .. ".php?" .. query .. "&y=" .. net.encode(key), { ["Accept"] = "application/json" })
  if type(res) == "table" and res.status == 404 then return nil, "not-found" end
  return net.decode(res, err)
end

-- The key must be taken and the user must exist.
function M.check(creds)
  local data, err = get("API_GetUserProfile", "u=" .. net.encode(creds.ra_user or ""), creds.ra_api or "")
  if data then return type(data.User) == "string" end
  if err == "key-refused" or err == "not-found" then return false end
  return nil
end

-- RetroAchievements writes a title's other names after a bar, and marks hacks and subsets in the title.
local function titles(text)
  local out = {}
  if text:find("~Hack~", 1, true) or text:find("[Subset", 1, true) then return out end
  for part in (text:gsub("~[^~]*~", " ")):gmatch("[^|]+") do
    if part:match("%S") then out[#out + 1] = (part:match("^%s*(.-)%s*$")) end
  end
  return out
end

-- Every game of a console that has achievements: { { id, titles, hashes } }, or nil and a reason.
function M.list(console)
  local key = keys.get("ra_api")
  if not key then return nil, "key-refused" end
  local data, err = get("API_GetGameList", string.format("i=%d&f=1&h=1", console), key)
  if not data then return nil, err end
  local out = {}
  for _, game in ipairs(data) do
    if type(game) == "table" and tonumber(game.ID) and type(game.Title) == "string" then
      local hashes = {}
      for _, hash in ipairs(type(game.Hashes) == "table" and game.Hashes or {}) do
        if type(hash) == "string" then hashes[#hashes + 1] = hash:lower() end
      end
      out[#out + 1] = { id = tonumber(game.ID), titles = titles(game.Title), hashes = hashes }
    end
  end
  return out
end

-- Days since 1970 for a date.
local function days(y, m, d)
  if m <= 2 then y, m = y - 1, m + 12 end
  return 365 * y + math.floor(y / 4) - math.floor(y / 100) + math.floor(y / 400) + math.floor((153 * (m - 3) + 2) / 5) + d - 719469
end

-- "2024-03-01 12:34:56" (UTC) as seconds since 1970, or 0.
function M.seconds(text)
  local y, mo, d, h, mi, s = tostring(text or ""):match("^(%d%d%d%d)%-(%d%d)%-(%d%d)[ T](%d%d):(%d%d):(%d%d)")
  if not y then return 0 end
  return days(tonumber(y), tonumber(mo), tonumber(d)) * 86400 + tonumber(h) * 3600 + tonumber(mi) * 60 + tonumber(s)
end

-- A game's achievements with the signed-in player's unlocks: { id, title, console, icon, items }, or nil and a reason.
function M.game(id)
  local key, user = keys.get("ra_api"), keys.get("ra_user")
  if not key or not user then return nil, "key-refused" end
  local data, err = get("API_GetGameInfoAndUserProgress", string.format("g=%d&u=%s", id, net.encode(user)), key)
  if not data then return nil, err end
  if not tonumber(data.ID) or type(data.Title) ~= "string" then return nil, "not-found" end
  local players = tonumber(data.NumDistinctPlayers) or 0
  local items = {}
  for _, a in pairs(type(data.Achievements) == "table" and data.Achievements or {}) do
    if type(a) == "table" and tonumber(a.ID) and type(a.Title) == "string" then
      local badge = tostring(a.BadgeName or "")
      local earned = a.DateEarned or a.DateEarnedHardcore
      items[#items + 1] = {
        id = string.format("%d", tonumber(a.ID)),
        name = a.Title,
        description = type(a.Description) == "string" and a.Description or "",
        icon = badge ~= "" and (MEDIA .. "/Badge/" .. badge .. ".png") or "",
        icon_locked = badge ~= "" and (MEDIA .. "/Badge/" .. badge .. "_lock.png") or "",
        unlocked = type(earned) == "string" and math.max(1, M.seconds(earned)) or 0,
        pct = players > 0 and math.min(100, math.floor((tonumber(a.NumAwarded) or 0) * 1000 / players + 0.5) / 10) or 0,
        order = tonumber(a.DisplayOrder) or 0,
      }
    end
  end
  table.sort(items, function(a, b)
    if a.order ~= b.order then return a.order < b.order end
    return tonumber(a.id) < tonumber(b.id)
  end)
  for _, item in ipairs(items) do item.order = nil end
  return {
    id = tonumber(data.ID),
    title = data.Title,
    console = type(data.ConsoleName) == "string" and data.ConsoleName or "",
    icon = type(data.ImageIcon) == "string" and data.ImageIcon ~= "" and (MEDIA .. data.ImageIcon) or "",
    items = items,
  }
end

return M
