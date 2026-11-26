-- Reads Steam's shortcuts.vdf (binary VDF); never writes it.
local files = require("files")
local paths = require("paths")

local M = {}

-- One map of the file: its table and the position after it.
local function map(s, pos, depth)
  if depth > 8 then error("too deep") end
  local out = {}
  while true do
    local kind = s:byte(pos)
    if kind == nil or kind == 8 then return out, pos + 1 end
    local key_end = s:find("\0", pos + 1, true)
    if not key_end then error("cut short") end
    local key = s:sub(pos + 1, key_end - 1):lower()
    pos = key_end + 1
    if kind == 0 then
      out[key], pos = map(s, pos, depth + 1)
    elseif kind == 1 then
      local value_end = s:find("\0", pos, true)
      if not value_end then error("cut short") end
      out[key] = s:sub(pos, value_end - 1)
      pos = value_end + 1
    elseif kind == 2 then
      local a, b, c, d = s:byte(pos, pos + 3)
      if not d then error("cut short") end
      out[key] = a + b * 256 + c * 65536 + d * 16777216
      pos = pos + 4
    elseif kind == 7 then
      pos = pos + 8
    else
      error("unknown field type")
    end
  end
end

-- Every shortcut as { appid, name, icon, exe, options }, or nil when the file cannot be read.
function M.shortcuts()
  local path = paths.shortcuts()
  local body = path and files.read(path)
  if not body then return nil end
  local ok, root = pcall(map, body, 1, 0)
  if not ok or type(root.shortcuts) ~= "table" then return nil end
  local out = {}
  for _, entry in pairs(root.shortcuts) do
    if type(entry) == "table" and tonumber(entry.appid) then
      local text = function(v) return type(v) == "string" and v or "" end
      out[#out + 1] = { appid = entry.appid, name = entry.appname or "", icon = text(entry.icon), exe = text(entry.exe), options = text(entry.launchoptions) }
    end
  end
  return out
end

-- A shortcut's icon path ("" when Steam draws it from the program), or nil when unknown.
function M.icon(appid)
  for _, entry in ipairs(M.shortcuts() or {}) do
    if entry.appid == appid then return entry.icon end
  end
  return nil
end

return M
