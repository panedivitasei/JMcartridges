-- Where Steam and the plugin keep their files.
local fs = require("fs")
local millennium = require("millennium")

local M = {}

local account -- the signed-in account, as the frontend reported it
local data

local function slash(p)
  return (tostring(p):gsub("\\", "/"):gsub("/+$", ""))
end

local function read(path)
  local f = io.open(path, "rb")
  if not f then return nil end
  local body = f:read("*a")
  f:close()
  return body
end

function M.steam()
  local ok, p = pcall(millennium.steam_path)
  return ok and type(p) == "string" and p ~= "" and slash(p) or nil
end

-- The plugin's data folder, made on first use.
function M.data()
  if data then return data end
  data = (M.steam() or ".") .. "/millennium/config/jmcartridges"
  pcall(function()
    if not fs.is_directory(data) then fs.create_directories(data) end
  end)
  return data
end

function M.file(name)
  return M.data() .. "/" .. name
end

-- A folder inside the data folder, made on first use.
function M.dir(name)
  local dir = M.file(name)
  pcall(function()
    if not fs.is_directory(dir) then fs.create_directories(dir) end
  end)
  return dir
end

function M.set_account(id)
  local n = tonumber(id)
  account = n and n > 0 and string.format("%d", n) or nil
end

-- The low 32 bits of a 64-bit Steam id written in decimal.
local function account_of(steam_id)
  local r = 0
  for i = 1, #steam_id do r = (r * 10 + (steam_id:byte(i) - 48)) % 4294967296 end
  return string.format("%d", r)
end

-- The account loginusers.vdf marks as most recent, else the one that signed in last.
local function recent_account(steam)
  local text = read(steam .. "/config/loginusers.vdf")
  local current, newest, newest_at = nil, nil, -1
  for line in (text or ""):gmatch("[^\r\n]+") do
    local id = line:match('^%s*"(%d%d+)"%s*$')
    if id then
      current = id
    elseif current then
      if line:match('"[Mm]ost[Rr]ecent"%s*"1"') then return account_of(current) end
      local at = tonumber(line:match('"[Tt]imestamp"%s*"(%d+)"'))
      if at and at > newest_at then newest, newest_at = current, at end
    end
  end
  return newest and account_of(newest) or nil
end

-- The signed-in user's folder under userdata, or nil.
function M.user()
  local steam = M.steam()
  if not steam then return nil end
  local userdata = steam .. "/userdata"
  for _, id in ipairs({ account or false, recent_account(steam) or false }) do
    if id and fs.is_directory(userdata .. "/" .. id) then return userdata .. "/" .. id end
  end
  local ok, entries = pcall(fs.list, userdata)
  local only
  for _, e in ipairs(ok and entries or {}) do
    if e.is_directory and e.name:match("^%d+$") and e.name ~= "0" then
      if only then return nil end
      only = e.name
    end
  end
  return only and (userdata .. "/" .. only) or nil
end

function M.grid()
  local user = M.user()
  return user and (user .. "/config/grid") or nil
end

function M.shortcuts()
  local user = M.user()
  return user and (user .. "/config/shortcuts.vdf") or nil
end

return M
