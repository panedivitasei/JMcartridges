-- IGDB as a source: search, Game Info, and the cover and key art.
local keys = require("keys")
local net = require("net")

local M = { id = "igdb", needs = { "twitch_client_id", "twitch_client_secret" } }

M.deps = { now = nil }

local IMAGES = "https://images.igdb.com/igdb/image/upload/"
local SEARCH_FIELDS = "fields name, first_release_date, platforms.name, total_rating_count, game_type, version_parent; "
local INFO_FIELDS = "fields name, summary, first_release_date, involved_companies.company.name, involved_companies.developer, involved_companies.publisher, franchise.name, franchises.name, game_modes.name, genres.name; "
local ART_FIELDS = "fields cover.image_id, game_localizations.cover.image_id, artworks.image_id, artworks.width, artworks.height, screenshots.image_id; "

local token, token_until, token_for = nil, 0, nil
local art_cache = {}

local function now()
  return (M.deps.now or os.time)()
end

function M.reset()
  token, token_until, token_for, art_cache = nil, 0, nil, {}
end

-- A Twitch app token for the given sign-in: the token, or nil and a reason.
local function sign_in(id, secret)
  local url = "https://id.twitch.tv/oauth2/token?client_id=" .. net.encode(id) .. "&client_secret=" .. net.encode(secret) .. "&grant_type=client_credentials"
  local res, err = net.post("igdb", url, "", { ["Accept"] = "application/json" })
  if type(res) == "table" and (res.status == 400 or res.status == 401 or res.status == 403) then return nil, "key-refused" end
  local data, why = net.decode(res, err)
  if not data or type(data.access_token) ~= "string" then return nil, why or "not-reached" end
  return data.access_token, tonumber(data.expires_in) or 3600
end

function M.check(creds)
  local t, err = sign_in(creds.twitch_client_id or "", creds.twitch_client_secret or "")
  if t then return true end
  return err == "key-refused" and false or nil
end

local function current_token()
  local id, secret = keys.get("twitch_client_id"), keys.get("twitch_client_secret")
  if not id or not secret then return nil, nil, "key-refused" end
  if token and token_for == id and now() < token_until then return token, id end
  local t, lasts = sign_in(id, secret)
  if not t then return nil, nil, lasts end
  token, token_for, token_until = t, id, now() + lasts - 300
  return token, id
end

-- One query: the list of games, or nil and a reason.
function M.query(apicalypse)
  local t, id, err = current_token()
  if not t then return nil, err end
  local res, why = net.post("igdb", "https://api.igdb.com/v4/games", apicalypse, {
    ["Client-ID"] = id,
    ["Authorization"] = "Bearer " .. t,
    ["Content-Type"] = "text/plain",
    ["Accept"] = "application/json",
  })
  if type(res) == "table" and res.status == 401 then token = nil end
  return net.decode(res, why)
end

local function quoted(text)
  return (tostring(text):gsub('[%c"\\]', " "):gsub("%s+", " "):gsub("^%s+", ""):gsub("%s+$", ""))
end

-- Main games before ports and bundles, add-ons last.
local function kind_rank(game)
  local kind = type(game.game_type) == "table" and game.game_type.id or game.game_type
  kind = tonumber(kind) or 0
  if tonumber(game.version_parent) then return 1 end
  if kind == 0 then return 3 end
  if kind == 4 or kind == 8 or kind == 9 or kind == 10 or kind == 11 then return 2 end
  if kind == 3 or kind == 5 or kind == 12 or kind == 13 then return 0 end
  return 1
end

function M.search(term)
  local text = quoted(term)
  if text == "" then return {} end
  local found, err = M.query(SEARCH_FIELDS .. 'search "' .. text .. '"; limit 30;')
  if not found then return nil, err end
  -- A second ask by the typed words, for a part of a title the search endpoint does not find.
  local parts = {}
  for word in text:gsub("%p", " "):gmatch("%S+") do
    if #word >= 2 and #parts < 6 then parts[#parts + 1] = 'name ~ *"' .. word .. '"*' end
  end
  if #found < 5 and #parts > 0 then
    for _, game in ipairs(M.query(SEARCH_FIELDS .. "where " .. table.concat(parts, " & ") .. "; sort total_rating_count desc; limit 30;") or {}) do
      found[#found + 1] = game
    end
  end
  local out, seen = {}, {}
  for _, game in ipairs(found) do
    local id = type(game) == "table" and tonumber(game.id)
    if id and type(game.name) == "string" and not seen[id] then
      seen[id] = true
      local platforms = {}
      for _, p in ipairs(type(game.platforms) == "table" and game.platforms or {}) do
        if type(p) == "table" and type(p.name) == "string" and #platforms < 6 then platforms[#platforms + 1] = p.name end
      end
      local stamp = tonumber(game.first_release_date)
      out[#out + 1] = {
        id = id,
        name = game.name,
        year = stamp and stamp > 0 and tonumber(os.date("!%Y", stamp)) or nil,
        platforms = platforms,
        weight = kind_rank(game) * 1000000 + math.min(tonumber(game.total_rating_count) or 0, 999999),
      }
    end
  end
  return out
end

local function names(list)
  local out, seen = {}, {}
  for _, item in ipairs(type(list) == "table" and list or {}) do
    local name = type(item) == "table" and item.name
    if type(name) == "string" and name ~= "" and not seen[name] then
      seen[name] = true
      out[#out + 1] = name
    end
  end
  return out
end

function M.info(id)
  local found, err = M.query(INFO_FIELDS .. string.format("where id = %d; limit 1;", id))
  if not found then return nil, err end
  local game = found[1]
  if type(game) ~= "table" or type(game.name) ~= "string" then return nil, "not-found" end
  local developers, publishers = {}, {}
  for _, c in ipairs(type(game.involved_companies) == "table" and game.involved_companies or {}) do
    local name = type(c) == "table" and type(c.company) == "table" and c.company.name
    if type(name) == "string" then
      if c.developer then developers[#developers + 1] = name end
      if c.publisher then publishers[#publishers + 1] = name end
    end
  end
  local franchises = names(game.franchises)
  if type(game.franchise) == "table" and type(game.franchise.name) == "string" and #franchises == 0 then franchises = { game.franchise.name } end
  local modes = {}
  for _, name in ipairs(names(game.game_modes)) do
    local low = name:lower()
    if low:find("single", 1, true) then modes.single = true end
    if low:find("multi", 1, true) then modes.multi = true end
    if low:find("co-op", 1, true) or low:find("coop", 1, true) or low:find("cooperative", 1, true) then modes.coop = true end
  end
  local stamp = tonumber(game.first_release_date)
  return {
    title = game.name,
    description = type(game.summary) == "string" and game.summary or "",
    developers = developers,
    publishers = publishers,
    franchises = franchises,
    genres = names(game.genres),
    release_date = stamp and stamp > 0 and os.date("!%Y-%m-%d", stamp) or "",
    modes = modes,
  }
end

-- The matched game's picture ids: tall ones (covers) and wide ones (key art, then screenshots).
local function pictures(id)
  local hit = art_cache[id]
  if hit and now() - hit.at < 600 then return hit.pictures end
  local found = M.query(ART_FIELDS .. string.format("where id = %d; limit 1;", id))
  if not found then return nil end
  local game = type(found[1]) == "table" and found[1] or {}
  local out, seen = { tall = {}, wide = {} }, {}
  local function add(to, picture)
    local image = type(picture) == "table" and picture.image_id
    if type(image) ~= "string" or not image:match("^[%w_]+$") or seen[image] then return end
    seen[image] = true
    to[#to + 1] = image
  end
  add(out.tall, game.cover)
  for _, region in ipairs(type(game.game_localizations) == "table" and game.game_localizations or {}) do
    if type(region) == "table" then add(out.tall, region.cover) end
  end
  for _, art in ipairs(type(game.artworks) == "table" and game.artworks or {}) do
    if type(art) == "table" then
      local w, h = tonumber(art.width), tonumber(art.height)
      add(w and h and h > w and out.tall or out.wide, art)
    end
  end
  for _, shot in ipairs(type(game.screenshots) == "table" and game.screenshots or {}) do add(out.wide, shot) end
  art_cache[id] = { at = now(), pictures = out }
  return out
end

local MEDIA_FIELDS = "fields artworks.image_id, artworks.width, artworks.height, screenshots.image_id, screenshots.width, screenshots.height, videos.video_id; "

-- The matched game's trailers, artwork and screenshots for its page: a list, or nil and a reason.
function M.media(id)
  local found, err = M.query(MEDIA_FIELDS .. string.format("where id = %d; limit 1;", id))
  if not found then return nil, err end
  local game = type(found[1]) == "table" and found[1] or {}
  local out = {}
  for _, video in ipairs(type(game.videos) == "table" and game.videos or {}) do
    local code = type(video) == "table" and video.video_id
    if type(code) == "string" and code:match("^[%w_%-]+$") then out[#out + 1] = { kind = "video", youtube = code } end
  end
  for _, kind in ipairs({ "artwork", "screenshot" }) do
    for _, picture in ipairs(type(game[kind .. "s"]) == "table" and game[kind .. "s"] or {}) do
      local image = type(picture) == "table" and picture.image_id
      if type(image) == "string" and image:match("^[%w_]+$") then
        out[#out + 1] = {
          kind = kind,
          url = IMAGES .. "t_1080p/" .. image .. ".jpg",
          thumb = IMAGES .. "t_screenshot_big/" .. image .. ".jpg",
          width = tonumber(picture.width),
          height = tonumber(picture.height),
        }
      end
    end
  end
  return out
end

function M.art(ref, slot)
  if not ref.id or (slot ~= "portrait" and slot ~= "hero" and slot ~= "wide") then return {} end
  local found = pictures(ref.id)
  if not found then return nil, "not-reached" end
  local tall = slot == "portrait"
  local out = {}
  for _, image in ipairs(tall and found.tall or found.wide) do
    out[#out + 1] = { url = IMAGES .. "t_1080p/" .. image .. ".jpg", thumb = IMAGES .. (tall and "t_cover_big/" or "t_screenshot_med/") .. image .. ".jpg" }
  end
  return out
end

return M
