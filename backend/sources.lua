-- The sources, their order, their switches and their sign-ins.
local keys = require("keys")
local log = require("log")
local net = require("net")
local state = require("state")

local M = {}

-- The order of an install that never changed it; Steam always stays first.
M.LIST = { "steam", "igdb", "thegamesdb", "steamgriddb", "retroachievements" }
M.MATCHABLE = { steam = true, igdb = true, thegamesdb = true }

local MODULES = { steam = "src_steam", igdb = "src_igdb", thegamesdb = "src_tgdb", steamgriddb = "src_sgdb", retroachievements = "src_ra" }

function M.get(id)
  return MODULES[id] and require(MODULES[id]) or nil
end

-- Every source, in the user's order.
function M.order()
  local out, seen = {}, {}
  local function add(id)
    if MODULES[id] and not seen[id] then
      seen[id] = true
      out[#out + 1] = id
    end
  end
  add("steam")
  for id in tostring(state.prefs().source_order):gmatch("[^,%s]+") do add(id) end
  for _, id in ipairs(M.LIST) do add(id) end
  return out
end

function M.signed(id)
  local src = M.get(id)
  return src ~= nil and keys.has(src.needs)
end

function M.on(id)
  return MODULES[id] ~= nil and state.prefs().off[id] ~= true
end

-- Switched on, and signed in when it needs a key.
function M.in_use(id)
  return M.on(id) and M.signed(id)
end

function M.set_on(id, on)
  if not MODULES[id] then return end
  local off = state.prefs().off
  off[id] = (not on) and true or nil
  state.set_prefs({ off = off })
  log.line("sources", id .. (on and " on" or " off"))
end

-- Asks the source whether it takes the sign-in: taken, it is saved and the source turned on; otherwise nothing is kept.
function M.sign_in(id, creds)
  local src = M.get(id)
  if not src or #src.needs == 0 or type(creds) ~= "table" then return false end
  local given = {}
  for _, name in ipairs(src.needs) do
    local v = creds[name]
    if type(v) ~= "string" or v:match("^%s*$") then return false end
    given[name] = v:match("^%s*(.-)%s*$")
  end
  net.resume(id)
  local ok, taken = pcall(src.check, given)
  log.line("sources", id .. " sign-in " .. ((ok and taken == true) and "taken" or "refused"))
  if not ok or taken ~= true then return false end
  keys.set(given)
  if src.reset then src.reset() end
  M.set_on(id, true)
  return true
end

-- The sources of pictures in use, as one text: it changes when they do.
function M.signature()
  local out = {}
  for _, id in ipairs(M.order()) do
    if M.in_use(id) and type(M.get(id).art) == "function" then out[#out + 1] = id end
  end
  return table.concat(out, ",")
end

return M
