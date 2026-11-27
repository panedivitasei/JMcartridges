-- Bookkeeping around a game's pictures; Steam itself writes its own files when the frontend asks it to.
local utils = require("utils")
local files = require("files")
local log = require("log")
local net = require("net")
local paths = require("paths")
local sources = require("sources")
local state = require("state")
local vdf = require("vdf")

local M = {}

-- The ending of a slot's file name in Steam's grid folder.
M.SUFFIX = { portrait = "p", hero = "_hero", logo = "_logo", wide = "" }
M.SLOTS = { "portrait", "hero", "logo", "wide", "icon" }
M.MAX_BYTES = 24 * 1024 * 1024
-- An image goes to the page in pieces: Millennium refuses one answer over 8 MB.
M.CHUNK_BYTES = 1500000
M.MAX_PER_SOURCE = 12
M.KEEP_SHORTCUT_BACKUPS = 10

M.deps = { now = nil }

local function now()
  return (M.deps.now or os.time)()
end

-- The image type of some bytes by their first bytes, or nil.
function M.sniff(body)
  if type(body) ~= "string" or #body < 12 then return nil end
  if body:sub(1, 8) == "\137PNG\r\n\26\n" then return "png" end
  if body:sub(1, 3) == "\255\216\255" then return "jpg" end
  if body:sub(1, 6) == "GIF87a" or body:sub(1, 6) == "GIF89a" then return "gif" end
  if body:sub(1, 4) == "RIFF" and body:sub(9, 12) == "WEBP" then return "webp" end
  if body:sub(5, 8) == "ftyp" and (body:sub(9, 12) == "avif" or body:sub(9, 12) == "avis") then return "avif" end
  if body:sub(1, 4) == "\0\0\1\0" and body:byte(5) + body:byte(6) * 256 > 0 then return "ico" end
  if body:sub(1, 4) == "II*\0" or body:sub(1, 4) == "MM\0*" then return "tiff" end
  if body:sub(1, 2) == "BM" and #body >= 18 then
    local header = body:byte(15) + body:byte(16) * 256 + body:byte(17) * 65536 + body:byte(18) * 16777216
    for _, size in ipairs({ 12, 40, 52, 56, 64, 108, 124 }) do
      if header == size then return "bmp" end
    end
  end
  return nil
end

local B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local B64_VALUE = {}
for i = 1, #B64 do B64_VALUE[B64:byte(i)] = i - 1 end

function M.decode_base64(text)
  local out, acc, bits = {}, 0, 0
  for i = 1, #text do
    local v = B64_VALUE[text:byte(i)]
    if v then
      acc, bits = acc * 64 + v, bits + 6
      if bits >= 8 then
        bits = bits - 8
        local byte = math.floor(acc / 2 ^ bits)
        acc = acc - byte * 2 ^ bits
        out[#out + 1] = string.char(byte)
        if #out >= 4096 then out = { table.concat(out) } end
      end
    end
  end
  return table.concat(out)
end

-- Piece `index` (from 0) of an image for the page: { base64, ext, index, chunks }.
local function piece(body, ext, index)
  local chunks = math.max(1, math.ceil(#body / M.CHUNK_BYTES))
  local i = math.floor(tonumber(index) or 0)
  if i < 0 or i >= chunks then return { error = "not-found" } end
  local from = i * M.CHUNK_BYTES + 1
  return { base64 = utils.base64_encode(body:sub(from, from + M.CHUNK_BYTES - 1)), ext = ext, index = i, chunks = chunks }
end

local function plain_path(p)
  return (tostring(p):gsub('^"(.*)"$', "%1"))
end

-- The grid file that holds a slot's picture now, or nil.
local function slot_file(appid, slot)
  local grid, suffix = paths.grid(), M.SUFFIX[slot]
  if not grid or not suffix then return nil end
  for _, ext in ipairs({ ".png", ".jpg", ".jpeg" }) do
    local path = grid .. "/" .. state.key(appid) .. suffix .. ext
    if files.is_file(path) then return path end
  end
  return nil
end

local function records(appid)
  local rec = state.peek(appid)
  return rec and type(rec.art) == "table" and rec.art or {}
end

local function set_record(appid, slot, record)
  local rec = state.game(appid)
  if type(rec.art) ~= "table" then rec.art = {} end
  rec.art[slot] = record
  if next(rec.art) == nil then rec.art = nil end
  state.save()
end

local function backup_dir(appid)
  return paths.dir("art-backup/" .. state.key(appid))
end

-- The icon path in use: ours once Steam took it, else what shortcuts.vdf says.
local function icon_path(appid)
  local record = records(appid).icon
  if record and not record.pending and type(record.path) == "string" and record.path ~= "" then return record.path end
  return vdf.icon(state.appid(appid))
end

-- The sources in use and the game's match, as one text: a "No Logo" set by the plugin is asked about again when it changes.
function M.signature(appid)
  local rec = state.peek(appid)
  local match = rec and rec.match
  return sources.signature() .. "|" .. (match and (match.source .. ":" .. tostring(match.id)) or "")
end

-- What each slot holds, and whose choice it is.
function M.state(appid)
  local out, recs = {}, records(appid)
  for slot in pairs(M.SUFFIX) do
    local r = recs[slot]
    local path = slot_file(appid, slot)
    out[slot] = { present = path ~= nil, stamp = path and files.stamp(path) or nil, chosen = r ~= nil, fetched = r ~= nil and r.by == "match" or nil }
  end
  local logo, r = out.logo, recs.logo
  if r and r.source == "none" and logo.present then logo.none = true end
  if r and r.by == "auto" then
    logo.auto = true
    logo.asked_at = tonumber(r.asked_at) or 0
    logo.sig = r.sig
  end
  local rec = state.peek(appid)
  if rec and rec.logo_off then logo.off = true end
  logo.sig_now = M.signature(appid)
  local icon = icon_path(appid)
  local shown = icon ~= nil and icon ~= "" and not plain_path(icon):lower():match("%.exe$")
  out.icon = { present = shown and true or false, stamp = shown and files.stamp(plain_path(icon)) or nil, chosen = recs.icon ~= nil }
  return out
end

-- The picture a slot shows now, in pieces, or { empty = true }.
function M.read(appid, slot, index)
  local path
  if slot == "icon" then
    local icon = icon_path(appid)
    if icon and icon ~= "" then path = plain_path(icon) end
  else
    path = slot_file(appid, slot)
  end
  if not path or plain_path(path):lower():match("%.exe$") then return { empty = true } end
  if (files.size(path) or 0) > M.MAX_BYTES then return { error = "too-large" } end
  local body = files.read(path)
  local ext = M.sniff(body)
  if not ext then return { empty = true } end
  return piece(body, ext, index)
end

-- The picture kept from before the first change, in pieces.
function M.read_backup(appid, slot, index)
  local record = records(appid)[slot]
  if not record or type(record.backup) ~= "string" then return { error = "not-found" } end
  local body = files.read(backup_dir(appid) .. "/" .. record.backup)
  local ext = M.sniff(body)
  if not ext then return { error = "not-found" } end
  return piece(body, ext, index)
end

-- An image file on this computer, in pieces.
function M.read_file(path, index)
  if type(path) ~= "string" then return { error = "not-found" } end
  local p = plain_path((path:gsub("^%s+", ""):gsub("%s+$", "")))
  if p == "" or not files.is_file(p) then return { error = "not-found" } end
  if (files.size(p) or 0) > M.MAX_BYTES then return { error = "too-large" } end
  local body = files.read(p)
  if not body then return { error = "not-found" } end
  local ext = M.sniff(body)
  if not ext then return { error = "unsupported" } end
  return piece(body, ext, index)
end

local fetched = {}

-- An image behind a link, in pieces; fetched once, later pieces come from memory.
function M.fetch(url, index)
  if type(url) ~= "string" or not url:match("^https?://[%w%.%-]+[:/]") then return { error = "bad-link" } end
  if fetched.url == url and (tonumber(index) or 0) > 0 then return piece(fetched.body, fetched.ext, index) end
  local res, err = net.binary("pictures", url)
  if not res then return { error = err == "too-large" and "too-large" or "not-fetched" } end
  if res.status ~= 200 or type(res.body) ~= "string" then return { error = "not-fetched" } end
  local ext = M.sniff(res.body)
  if not ext then return { error = "unsupported" } end
  fetched = { url = url, body = res.body, ext = ext }
  return piece(res.body, ext, index)
end

-- Copies shortcuts.vdf into the data folder before Steam rewrites it, keeping the newest ten.
local function backup_shortcuts()
  local path = paths.shortcuts()
  local body = path and files.read(path)
  if not body then return false end
  local dir = paths.dir("shortcut-backups")
  local name = "shortcuts-" .. os.date("!%Y%m%d-%H%M%S", now())
  local target, n = dir .. "/" .. name .. ".vdf", 1
  while files.is_file(target) do
    n = n + 1
    target = dir .. "/" .. name .. "-" .. n .. ".vdf"
  end
  if not files.write(target, body) then return false end
  local kept = {}
  for _, e in ipairs(files.list(dir)) do
    if e.is_file and e.name:match("^shortcuts%-.*%.vdf$") then kept[#kept + 1] = e.name end
  end
  table.sort(kept)
  for i = 1, #kept - M.KEEP_SHORTCUT_BACKUPS do files.remove(dir .. "/" .. kept[i]) end
  return true
end

-- Before Steam is asked to change a slot: keeps what is there, the first time only.
function M.begin(appid, slot)
  if slot ~= "icon" and not M.SUFFIX[slot] then return { error = "bad-slot" } end
  local existing = records(appid)[slot]
  if slot == "icon" then
    local previous = vdf.icon(state.appid(appid))
    if previous == nil then return { error = "no-shortcut" } end
    if not backup_shortcuts() then return { error = "no-backup" } end
    if not existing then set_record(appid, slot, { previous = previous, pending = true, at = now() }) end
    return { ok = true }
  end
  if existing then return { ok = true, present = slot_file(appid, slot) ~= nil } end
  local record = { backup = false, pending = true, at = now() }
  local path = slot_file(appid, slot)
  if path then
    local body = files.read(path)
    if not body then return { error = "no-backup" } end
    -- A file that is no picture is not worth keeping, and must not lock the slot.
    local ext = M.sniff(body)
    if ext then
      local name = slot .. "." .. ext
      if not files.write(backup_dir(appid) .. "/" .. name, body) then return { error = "no-backup" } end
      record.backup = name
    end
  end
  set_record(appid, slot, record)
  return { ok = true, present = path ~= nil }
end

-- Steam refused the change: a record that was only begun is dropped again.
function M.cancel(appid, slot)
  local record = records(appid)[slot]
  if record and record.pending then
    if type(record.backup) == "string" then files.remove(backup_dir(appid) .. "/" .. record.backup) end
    set_record(appid, slot, nil)
  end
  return { ok = true }
end

-- After Steam took the picture: who chose it and where it came from.
function M.commit(appid, slot, how)
  local record = records(appid)[slot]
  if not record then return { error = "not-started" } end
  how = type(how) == "table" and how or {}
  local by = (how.by == "match" or how.by == "auto") and how.by or "user"
  record.pending = nil
  record.by = by
  record.source = type(how.source) == "string" and how.source or "file"
  record.url = type(how.url) == "string" and how.url or nil
  record.path = slot == "icon" and type(how.path) == "string" and how.path or nil
  record.sig = by == "auto" and type(how.sig) == "string" and how.sig or nil
  record.asked_at = by == "auto" and now() or nil
  record.at = now()
  if slot == "logo" and by == "user" then state.game(appid).logo_off = nil end
  set_record(appid, slot, record)
  if slot == "icon" then M.drop_icons(appid, record.path) end
  return { ok = true }
end

-- Removes the game's icon files in the data folder, but the one in use.
function M.drop_icons(appid, keep)
  local dir, key = paths.dir("icons"), state.key(appid)
  for _, e in ipairs(files.list(dir)) do
    local path = dir .. "/" .. e.name
    local same = keep ~= nil and path:lower():gsub("\\", "/") == tostring(keep):lower():gsub("\\", "/")
    if e.is_file and e.name:sub(1, #key + 1) == key .. "-" and not same then files.remove(path) end
  end
end

-- What Reset must do for a slot: restore the kept picture, clear the slot, put the icon back, or nothing.
function M.reset(appid, slot)
  local record = records(appid)[slot]
  if not record then return { nothing = true } end
  if slot == "icon" then
    if not backup_shortcuts() then return { error = "no-backup" } end
    return { icon_restore = type(record.previous) == "string" and record.previous or "" }
  end
  if type(record.backup) == "string" and M.sniff(files.read(backup_dir(appid) .. "/" .. record.backup)) then return { restore = true } end
  return { clear = true }
end

-- After Steam took the reset: the record and its kept picture go.
function M.reset_done(appid, slot, by_plugin)
  local record = records(appid)[slot]
  -- A logo the user reset is theirs to decide: no "No Logo" by the plugin again.
  if slot == "logo" and not by_plugin then state.game(appid).logo_off = true end
  if record and type(record.backup) == "string" then files.remove(backup_dir(appid) .. "/" .. record.backup) end
  set_record(appid, slot, nil)
  if slot == "icon" then M.drop_icons(appid) end
  return { ok = true }
end

-- The plugin set "No Logo" and asked again without finding one.
function M.logo_asked(appid, sig)
  local record = records(appid).logo
  if record and record.by == "auto" then
    record.asked_at = now()
    record.sig = type(sig) == "string" and sig or record.sig
    set_record(appid, "logo", record)
  end
  return { ok = true }
end

-- The slots whose picture came with the match, not from the user.
function M.from_match(appid)
  local out = {}
  for _, slot in ipairs(M.SLOTS) do
    local r = records(appid)[slot]
    if r and (r.by == "match" or r.by == "auto") then out[#out + 1] = slot end
  end
  return out
end

-- Stores a chosen icon's bytes in the data folder and gives the path Steam is pointed at.
function M.save_icon(appid, base64)
  local key = state.key(appid)
  local body = type(base64) == "string" and M.decode_base64(base64) or ""
  local ext = M.sniff(body)
  if ext ~= "png" and ext ~= "ico" and ext ~= "jpg" then return { error = "unsupported" } end
  if #body > M.MAX_BYTES then return { error = "too-large" } end
  -- The icon in use stays until Steam has taken the new one (commit removes it then).
  local dir = paths.dir("icons")
  local file = dir .. "/" .. key .. "-" .. string.format("%d", now()) .. "." .. ext
  local n = 1
  while files.is_file(file) do
    n = n + 1
    file = dir .. "/" .. key .. "-" .. string.format("%d", now()) .. "-" .. n .. "." .. ext
  end
  if not files.write(file, body) then return { error = "not-saved" } end
  if file:match("^%a:") then file = file:gsub("/", "\\") end
  return { path = file }
end

-- The small portraits the list shows, kept in the data folder: per game its portrait's stamp, and the small picture when one is kept for it.
function M.thumbs(appids)
  local dir, have, out = paths.dir("thumbs"), {}, {}
  for _, e in ipairs(files.list(dir)) do have[e.name] = true end
  for _, id in ipairs(type(appids) == "table" and appids or {}) do
    local appid = state.appid(id)
    local path = appid and slot_file(appid, "portrait")
    local stamp = path and files.stamp(path)
    if stamp then
      local name = state.key(appid) .. "-" .. stamp .. ".jpg"
      local body = have[name] and files.read(dir .. "/" .. name)
      out[state.key(appid)] = { stamp = stamp, base64 = body and utils.base64_encode(body) or nil }
    end
  end
  return out
end

-- Keeps a game's small portrait for the portrait with this stamp; the ones of older portraits go.
function M.save_thumb(appid, stamp, base64)
  local key = state.key(appid)
  if type(stamp) ~= "string" or not stamp:match("^%d+%-%d+$") then return { error = "unknown" } end
  local body = type(base64) == "string" and M.decode_base64(base64) or ""
  if M.sniff(body) ~= "jpg" or #body > 200000 then return { error = "unsupported" } end
  local dir = paths.dir("thumbs")
  for _, e in ipairs(files.list(dir)) do
    if e.is_file and e.name:sub(1, #key + 1) == key .. "-" then files.remove(dir .. "/" .. e.name) end
  end
  if not files.write(dir .. "/" .. key .. "-" .. stamp .. ".jpg", body) then return { error = "not-saved" } end
  return { ok = true }
end

-- The pictures a slot can take, source by source in the user's order: { options, needs_key, error }.
function M.options(appid, slot, name, term)
  local rec = state.peek(appid)
  local match = rec and rec.match
  local searching = type(term) == "string" and term:match("%S") ~= nil
  local out = { options = {}, needs_key = false }
  for _, id in ipairs(sources.order()) do
    if id == "steamgriddb" and not sources.signed(id) then out.needs_key = true end
    if sources.gives(id, "art") and type(sources.get(id).art) == "function" then
      local ref = { title = searching and term or name }
      if not searching and match then
        if match.source == id then ref.id = match.id end
        if match.source == "steam" then ref.steam = match.id end
      end
      local ok, list, err = pcall(sources.get(id).art, ref, slot)
      if not ok or not list then
        out.error = out.error or (id .. "-" .. (ok and tostring(err or "not-reached") or "not-reached"))
      else
        for i = 1, math.min(#list, M.MAX_PER_SOURCE) do
          out.options[#out.options + 1] = { url = list[i].url, thumb = list[i].thumb, source = id, by_hand = list[i].by_hand or nil }
        end
      end
    end
  end
  if #out.options > 0 then out.needs_key = false end
  log.line("art", string.format("%s %s: %d option(s)%s", state.key(appid), tostring(slot), #out.options, out.error and (" (" .. out.error .. ")") or ""))
  return out
end

return M
