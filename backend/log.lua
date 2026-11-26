-- The plugin's log file, with saved keys taken out of every line.
local paths = require("paths")

local M = {}

M.MAX_BYTES = 1024 * 1024

local secrets = {}

-- The values the log must never show.
function M.hide(values)
  secrets = {}
  for _, v in pairs(values or {}) do
    if type(v) == "string" and #v >= 4 then secrets[#secrets + 1] = v end
  end
end

function M.scrub(text)
  text = tostring(text)
  for _, secret in ipairs(secrets) do
    local from = 1
    while true do
      local a, b = text:find(secret, from, true)
      if not a then break end
      text = text:sub(1, a - 1) .. "***" .. text:sub(b + 1)
      from = a + 3
    end
  end
  return (text:gsub("([?&][%w_]*[Kk]ey=)[^&%s]+", "%1***"):gsub("(client_secret=)[^&%s]+", "%1***"))
end

function M.path()
  return paths.file("log.txt")
end

-- Keeps the newer half once the file is over its size.
local function trim(path)
  local f = io.open(path, "rb")
  if not f then return end
  local size = f:seek("end")
  if size <= M.MAX_BYTES then
    f:close()
    return
  end
  f:seek("set", size - math.floor(M.MAX_BYTES / 2))
  local tail = f:read("*a") or ""
  f:close()
  local out = io.open(path, "wb")
  if out then
    out:write((tail:gsub("^[^\n]*\n", "")))
    out:close()
  end
end

local primed = false

function M.line(tag, message)
  -- The saved keys are read before the first line, so none can be written in it.
  if not primed then
    primed = true
    pcall(function() require("keys").get("") end)
  end
  pcall(function()
    local path = M.path()
    trim(path)
    local f = io.open(path, "ab")
    if not f then return end
    f:write(os.date("!%Y-%m-%d %H:%M:%S") .. " [" .. tostring(tag) .. "] " .. M.scrub(message):gsub("[\r\n]+", " ") .. "\n")
    f:close()
  end)
end

return M
