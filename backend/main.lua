-- JMcartridges: backend entry point.

-- Compiled traces crash Millennium's 64-bit Lua host at the C boundary, so the interpreter runs everything.
if jit and jit.off then jit.off() end

local millennium = require("millennium")
local log = require("log")
local paths = require("paths")

-- Millennium calls a global function per method name.
for name, fn in pairs(require("rpc")) do _G[name] = fn end

-- No file is read here: an error inside a C function while the host loads the backend takes the host down, even under pcall.
local function on_load()
  millennium.ready()
end

local function on_frontend_loaded()
  pcall(function()
    local ok, version = pcall(millennium.version)
    log.line("start", string.format("millennium=%s steam=%s user=%s", tostring(ok and version or "unknown"), tostring(paths.steam()), paths.user() and "found" or "not found"))
  end)
end

local function on_unload()
  pcall(log.line, "stop", "backend unloading")
end

return { on_load = on_load, on_frontend_loaded = on_frontend_loaded, on_unload = on_unload }
