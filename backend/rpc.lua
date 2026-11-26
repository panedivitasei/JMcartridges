-- The calls the frontend can make: each takes JSON text and answers JSON text.
local json = require("json")
local achievements = require("achievements")
local art = require("art")
local games = require("games")
local log = require("log")
local media = require("media")
local paths = require("paths")
local sources = require("sources")
local state = require("state")

local M = {}

-- Millennium hands the payload over as text, as a table, or wrapped in { payload = text }.
local function decode(payload)
  local data = payload
  if type(data) == "string" then
    local ok, value = pcall(json.decode, data)
    data = ok and value or {}
  end
  if type(data) == "table" and type(data.payload) == "string" then
    local ok, value = pcall(json.decode, data.payload)
    data = ok and value or {}
  end
  return type(data) == "table" and data or {}
end

-- Wraps a handler: it never throws across the boundary and never answers nil, which crashes the host.
local function method(name, handler)
  M[name] = function(payload)
    if jit and jit.off then jit.off() end
    local data = decode(payload)
    if data.appid ~= nil then
      data.appid = state.appid(data.appid)
      if not data.appid then return json.encode({ error = "bad-game" }) end
    end
    local ok, result = pcall(handler, data)
    if not ok then
      log.line("rpc", name .. " failed: " .. tostring(result))
      return json.encode({ error = "unknown" })
    end
    local encoded, text = pcall(json.encode, result == nil and { ok = true } or result)
    return encoded and text or json.encode({ error = "unknown" })
  end
end

method("JmState", function()
  local list = {}
  for _, id in ipairs(sources.order()) do
    list[#list + 1] = { id = id, on = sources.on(id), signed = sources.signed(id), needs = sources.get(id).needs, matchable = sources.MATCHABLE[id] == true, media = media.wanted(id) }
  end
  local prefs = state.prefs()
  return { prefs = { theme = prefs.theme, show_info = prefs.show_info, achievements = prefs.achievements, desc_limit = prefs.desc_limit, opened = prefs.opened }, sources = list }
end)

method("JmSetPrefs", function(d)
  local change = type(d.prefs) == "table" and d.prefs or {}
  -- The switches have a call of their own.
  change.off = nil
  change.media_off = nil
  -- A whole number of characters, 0 for no limit.
  if type(change.desc_limit) == "number" then change.desc_limit = math.max(0, math.min(100000, math.floor(change.desc_limit))) end
  state.set_prefs(change)
end)

method("JmSetSource", function(d) sources.set_on(d.id, d.on == true) end)
method("JmSignIn", function(d) return { ok = sources.sign_in(d.id, d.credentials) } end)
method("JmSetAccount", function(d) paths.set_account(d.account) end)

method("JmGames", function(d) return { games = games.list(d.games) } end)
method("JmSearch", function(d) return games.search(d.term, type(d.source) == "string" and d.source or nil) end)
method("JmMatch", function(d) return games.match(d.appid, d.source, d.id) end)
method("JmUnmatch", function(d) return games.unmatch(d.appid) end)
method("JmSetState", function(d) return games.set_state(d.appid, d.state) end)
method("JmInfo", function(d) return games.info(d.appid) end)
method("JmSaveInfo", function(d) return games.save_info(d.appid, d.info) end)
method("JmResetInfo", function(d) return games.reset_info(d.appid) end)
method("JmAllInfo", function() return { games = games.all_info() } end)

method("JmArtState", function(d) return { slots = art.state(d.appid) } end)
method("JmArtRead", function(d) return art.read(d.appid, d.slot, d.index) end)
method("JmArtReadBackup", function(d) return art.read_backup(d.appid, d.slot, d.index) end)
method("JmArtReadFile", function(d) return art.read_file(d.path, d.index) end)
method("JmArtFetch", function(d) return art.fetch(d.url, d.index) end)
method("JmArtBegin", function(d) return art.begin(d.appid, d.slot) end)
method("JmArtCancel", function(d) return art.cancel(d.appid, d.slot) end)
method("JmArtCommit", function(d) return art.commit(d.appid, d.slot, d) end)
method("JmArtReset", function(d) return art.reset(d.appid, d.slot) end)
method("JmArtResetDone", function(d) return art.reset_done(d.appid, d.slot, d.by_plugin == true) end)
method("JmArtSaveIcon", function(d) return art.save_icon(d.appid, d.base64) end)
method("JmArtOptions", function(d) return art.options(d.appid, d.slot, d.name, d.term) end)
method("JmArtFromMatch", function(d) return { slots = art.from_match(d.appid) } end)
method("JmLogoAsked", function(d) return art.logo_asked(d.appid, d.sig) end)
method("JmThumbs", function(d) return { thumbs = art.thumbs(d.appids) } end)
method("JmThumbSave", function(d) return art.save_thumb(d.appid, d.stamp, d.base64) end)

method("JmMedia", function(d) return media.get(d.appid) end)
method("JmSetMedia", function(d) media.set_source(d.id, d.on == true) end)
method("JmMediaSized", function(d) return media.sized(d.appid, d.sizes) end)
method("JmAllMedia", function() return { games = media.all_kept() } end)

method("JmAchievements", function(d) return achievements.get(d.appid, d.name) end)
method("JmAllAchievements", function() return { games = achievements.all_kept() } end)

method("JmLog", function(d) log.line(tostring(d.tag or "window"):sub(1, 20), tostring(d.message or ""):sub(1, 500)) end)

return M
