-- File reads and writes, and JSON files in the data folder.
local fs = require("fs")
local json = require("json")
local paths = require("paths")

local M = {}

function M.read(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local body = f:read("*a")
  f:close()
  return body
end

-- Writes through a temporary file, and only a file written whole takes the place of the one before it.
function M.write(path, body)
  local tmp = path .. ".tmp"
  local f = io.open(tmp, "wb")
  if not f then return false end
  local written = f:write(body)
  local closed = f:close()
  if not written or not closed or M.size(tmp) ~= #body then
    pcall(os.remove, tmp)
    return false
  end
  -- The file before it is set aside, not removed: a crash between the two renames leaves it to be read.
  local old = path .. ".old"
  pcall(os.remove, old)
  local had = os.rename(path, old)
  if not os.rename(tmp, path) then
    if had then os.rename(old, path) end
    pcall(os.remove, tmp)
    return false
  end
  return true
end

-- A file's size in bytes, or nil.
function M.size(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local size = f:seek("end")
  f:close()
  return size
end

-- A file's size and time as one text, which changes when the file does; nil when there is none.
function M.stamp(path)
  local size = M.size(path)
  if not size then return nil end
  local ok, at = pcall(fs.last_write_time, path)
  return string.format("%d-%d", size, ok and tonumber(at) or 0)
end

function M.is_file(path)
  local ok, yes = pcall(fs.is_file, path)
  return ok and yes == true
end

function M.list(dir)
  local ok, entries = pcall(fs.list, dir)
  return ok and type(entries) == "table" and entries or {}
end

function M.remove(path)
  pcall(os.remove, path)
end

-- A JSON file of the data folder as a table, or `default` when missing or broken.
function M.load(name, default)
  -- The copy from before the last write is read when the file itself is missing or broken.
  for _, path in ipairs({ paths.file(name), paths.file(name) .. ".old" }) do
    local text = M.read(path)
    if text and #text > 0 then
      local ok, value = pcall(json.decode, text)
      if ok and type(value) == "table" then return value end
    end
  end
  return default
end

function M.save(name, value)
  local ok, text = pcall(json.encode, value)
  return ok and M.write(paths.file(name), text)
end

return M
