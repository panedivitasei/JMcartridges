-- The Steam store as a source: search, Game Info and Steam's own artwork.
local net = require("net")

local M = { id = "steam", needs = {} }

local MONTHS = { jan = 1, feb = 2, mar = 3, apr = 4, may = 5, jun = 6, jul = 7, aug = 8, sep = 9, oct = 10, nov = 11, dec = 12 }

-- The store's "9 Jul, 2013" or "Jul 9, 2013" as "2013-07-09", or "".
function M.date(text)
  if type(text) ~= "string" then return "" end
  local d, mon, y = text:match("^(%d+)%s+(%a+),?%s+(%d%d%d%d)$")
  if not d then mon, d, y = text:match("^(%a+)%s+(%d+),?%s+(%d%d%d%d)$") end
  local m = mon and MONTHS[mon:sub(1, 3):lower()]
  if not m or tonumber(d) < 1 or tonumber(d) > 31 then return "" end
  return string.format("%04d-%02d-%02d", tonumber(y), m, tonumber(d))
end

local function plain_text(html)
  if type(html) ~= "string" then return "" end
  local s = html:gsub("<br%s*/?>", " "):gsub("<[^>]*>", "")
  s = s:gsub("&quot;", '"'):gsub("&#39;", "'"):gsub("&lt;", "<"):gsub("&gt;", ">"):gsub("&nbsp;", " "):gsub("&amp;", "&")
  return (s:gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", ""))
end

function M.check()
  return true
end

function M.search(term)
  local data, err = net.decode(net.get("steam", "https://store.steampowered.com/api/storesearch/?term=" .. net.encode(term) .. "&cc=us&l=english"))
  if not data then return nil, err end
  local out = {}
  for _, item in ipairs(type(data.items) == "table" and data.items or {}) do
    if type(item) == "table" and tonumber(item.id) and type(item.name) == "string" and (item.type == nil or item.type == "app") then
      out[#out + 1] = { id = tonumber(item.id), name = item.name }
    end
  end
  return out
end

local MODES = { [2] = "single", [1] = "multi", [36] = "multi", [49] = "multi", [9] = "coop", [38] = "coop" }

local function strings(list)
  local out = {}
  for _, v in ipairs(type(list) == "table" and list or {}) do
    if type(v) == "string" and v ~= "" then out[#out + 1] = v end
  end
  return out
end

function M.info(id)
  local key = string.format("%d", id)
  local data, err = net.decode(net.get("steam", "https://store.steampowered.com/api/appdetails?appids=" .. key .. "&l=english&cc=us"))
  if not data then return nil, err end
  local game = type(data[key]) == "table" and data[key].success and data[key].data
  if type(game) ~= "table" or type(game.name) ~= "string" then return nil, "not-found" end
  local genres, modes = {}, {}
  for _, g in ipairs(type(game.genres) == "table" and game.genres or {}) do
    if type(g) == "table" and type(g.description) == "string" then genres[#genres + 1] = g.description end
  end
  for _, c in ipairs(type(game.categories) == "table" and game.categories or {}) do
    local mode = type(c) == "table" and MODES[tonumber(c.id)]
    if mode then modes[mode] = true end
  end
  return {
    title = game.name,
    description = plain_text(game.short_description),
    developers = strings(game.developers),
    publishers = strings(game.publishers),
    genres = genres,
    release_date = M.date(type(game.release_date) == "table" and game.release_date.date),
    modes = modes,
  }
end

-- The matched game's screenshots for its page: a list, or nil and a reason.
function M.media(id)
  local key = string.format("%d", id)
  local data, err = net.decode(net.get("steam", "https://store.steampowered.com/api/appdetails?appids=" .. key .. "&l=english&cc=us"))
  if not data then return nil, err end
  local game = type(data[key]) == "table" and data[key].success and data[key].data
  if type(game) ~= "table" then return nil, "not-found" end
  local out = {}
  for _, shot in ipairs(type(game.screenshots) == "table" and game.screenshots or {}) do
    local full = type(shot) == "table" and shot.path_full
    if type(full) == "string" and full:match("^https://") then
      local w, h = full:match("%.(%d+)x(%d+)%.")
      out[#out + 1] = { kind = "screenshot", url = full, thumb = type(shot.path_thumbnail) == "string" and shot.path_thumbnail or full, width = tonumber(w) or 1920, height = tonumber(h) or 1080 }
    end
  end
  return out
end

local FILES = { portrait = "library_600x900.jpg", hero = "library_hero.jpg", logo = "logo.png", wide = "header.jpg" }

-- Steam's own picture for a slot of a matched Steam game; the page checks that it exists.
function M.art(ref, slot)
  if not ref.id or not FILES[slot] then return {} end
  local url = "https://cdn.akamai.steamstatic.com/steam/apps/" .. string.format("%d", ref.id) .. "/" .. FILES[slot]
  return { { url = url, thumb = url, probe = true } }
end

return M
