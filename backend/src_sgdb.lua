-- SteamGridDB as a source: community pictures and icons for every slot.
local keys = require("keys")
local net = require("net")

local M = { id = "steamgriddb", needs = { "steamgriddb_api" } }

local API = "https://www.steamgriddb.com/api/v2"
local LISTS = {
  portrait = "/grids/game/%d?dimensions=600x900&types=static&nsfw=false",
  hero = "/heroes/game/%d?types=static&nsfw=false",
  logo = "/logos/game/%d?types=static&nsfw=false",
  wide = "/grids/game/%d?dimensions=920x430,460x215&types=static&nsfw=false",
  icon = "/icons/game/%d?types=static&nsfw=false&mimes=image/png,image/vnd.microsoft.icon",
}

local ids = {}

function M.reset()
  ids = {}
end

-- One request: the answer's data, {} for "not found", or nil and a reason.
local function get(path, key)
  local res, err = net.get("steamgriddb", API .. path, { ["Authorization"] = "Bearer " .. key, ["Accept"] = "application/json" })
  if type(res) == "table" and res.status == 404 then return {} end
  local data, why = net.decode(res, err)
  if not data then return nil, why end
  if data.success ~= true or type(data.data) ~= "table" then return nil, "not-reached" end
  return data.data
end

function M.check(creds)
  local data, err = get("/search/autocomplete/portal", creds.steamgriddb_api or "")
  if data then return true end
  return err == "key-refused" and false or nil
end

-- SteamGridDB's id for the game, by its matched Steam game or its name, remembered while Steam runs.
local function game_id(ref, key)
  local memo = tostring(ref.steam or "") .. "|" .. tostring(ref.title or "")
  if ids[memo] ~= nil then return ids[memo] or nil end
  local id, err
  if ref.steam then
    local data, why = get("/games/steam/" .. string.format("%d", ref.steam), key)
    if data and tonumber(data.id) then id = tonumber(data.id) elseif why then err = why end
  end
  local title = tostring(ref.title or ""):gsub("%b()", " "):gsub("%b[]", " "):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", "")
  if not id and title ~= "" then
    local data, why = get("/search/autocomplete/" .. net.encode(title), key)
    if data and type(data[1]) == "table" and tonumber(data[1].id) then id = tonumber(data[1].id) elseif why then err = why end
  end
  if not id and err then return nil, err end
  ids[memo] = id or false
  return id
end

function M.art(ref, slot)
  local key = keys.get("steamgriddb_api")
  if not key then return nil, "key-refused" end
  if not LISTS[slot] then return {} end
  local id, err = game_id(ref, key)
  if not id then
    if err then return nil, err end
    return {}
  end
  local data, why = get(string.format(LISTS[slot], id), key)
  if not data then return nil, why end
  local out, own = {}, {}
  for _, item in ipairs(data) do
    if type(item) == "table" and type(item.url) == "string" then
      local one = { url = item.url, thumb = type(item.thumb) == "string" and item.thumb or item.url }
      -- A logo that is not the game's official one goes after the official ones and is never taken without the user.
      if slot == "logo" and item.style ~= "official" then
        one.by_hand = true
        own[#own + 1] = one
      else
        out[#out + 1] = one
      end
    end
  end
  for _, one in ipairs(own) do out[#out + 1] = one end
  return out
end

return M
