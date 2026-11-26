-- The keys and sign-ins the user saved, in keys.json.
local files = require("files")
local log = require("log")
local paths = require("paths")

local M = {}

local FILE = "keys.json"
local cache

local function all()
  if not cache then
    cache = files.load(FILE, {})
    log.hide(cache)
  end
  return cache
end

function M.reset()
  cache = nil
end

function M.get(name)
  local v = all()[name]
  return type(v) == "string" and v ~= "" and v or nil
end

-- True when every named key is saved.
function M.has(names)
  for _, name in ipairs(names) do
    if not M.get(name) then return false end
  end
  return true
end

-- Saves the given names; an empty value removes one.
function M.set(map)
  local now = all()
  for name, value in pairs(map) do
    if type(name) == "string" then now[name] = type(value) == "string" and value ~= "" and value or nil end
  end
  files.save(FILE, now)
  log.hide(now)
  if package.config:sub(1, 1) ~= "\\" then pcall(os.execute, "chmod 600 '" .. paths.file(FILE) .. "' 2>/dev/null") end
end

return M
