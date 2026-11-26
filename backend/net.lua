-- Web requests, with a pause for a source that keeps failing.
local json = require("json")
local log = require("log")

local M = {}

M.FAILURES_BEFORE_PAUSE = 5
M.PAUSE_SECONDS = 15 * 60
M.PAUSE_429_SECONDS = 60
M.TIMEOUT = 15
M.MAX_BYTES = 24 * 1024 * 1024

-- Tests replace these.
M.deps = { http = nil, binary = nil, now = nil }

local failures, paused = {}, {}

local function now()
  return (M.deps.now or os.time)()
end

function M.reset()
  failures, paused = {}, {}
end

-- Lifts a source's pause: the user is asking for it now.
function M.resume(source)
  failures[source], paused[source] = 0, nil
end

local function is_paused(source)
  local till = paused[source]
  if not till then return false end
  if now() < till then return true end
  paused[source], failures[source] = nil, 0
  return false
end

-- Counts an answer toward the source's pause, and logs it.
local function record(source, method, url, res, err)
  local status = type(res) == "table" and tonumber(res.status) or 0
  if status == 429 then
    paused[source] = now() + M.PAUSE_429_SECONDS
  elseif status == 0 or status >= 500 then
    failures[source] = (failures[source] or 0) + 1
    if failures[source] >= M.FAILURES_BEFORE_PAUSE then paused[source] = now() + M.PAUSE_SECONDS end
  else
    failures[source] = 0
  end
  log.line("net", string.format("%s %s %s -> %s", source, method, url:gsub("%?.*$", ""), status > 0 and status or tostring(err or "no answer")))
end

local function http()
  if M.deps.http then return M.deps.http end
  local ok, mod = pcall(require, "http")
  return ok and mod or nil
end

-- GET: { status, body } or nil, reason.
function M.get(source, url, headers)
  if is_paused(source) then return nil, "paused" end
  local h = http()
  if not h or type(h.get) ~= "function" then return nil, "no http" end
  local ok, res = pcall(h.get, url, { headers = headers or {}, timeout = M.TIMEOUT })
  if not ok or type(res) ~= "table" then
    record(source, "GET", url, nil, res)
    return nil, "not-reached"
  end
  record(source, "GET", url, res)
  return res
end

-- POST: Millennium's builds differ in how a body is passed, so each known way is tried.
function M.post(source, url, body, headers)
  if is_paused(source) then return nil, "paused" end
  local h = http()
  if not h then return nil, "no http" end
  local opts = { headers = headers or {}, timeout = M.TIMEOUT }
  local tries = {}
  if type(h.request) == "function" then
    tries[#tries + 1] = function() return h.request(url, { method = "POST", data = body, headers = opts.headers, timeout = opts.timeout }) end
    tries[#tries + 1] = function() return h.request(url, { method = "POST", body = body, headers = opts.headers, timeout = opts.timeout }) end
  end
  if type(h.post) == "function" then
    tries[#tries + 1] = function() return h.post(url, { data = body, headers = opts.headers, timeout = opts.timeout }) end
    tries[#tries + 1] = function() return h.post(url, { body = body, headers = opts.headers, timeout = opts.timeout }) end
    tries[#tries + 1] = function() return h.post(url, body, opts) end
  end
  local last
  for _, try in ipairs(tries) do
    local ok, res = pcall(try)
    if ok and type(res) == "table" and tonumber(res.status) then
      last = res
      if (res.status >= 200 and res.status < 300) or res.status == 400 or res.status == 401 or res.status == 403 then break end
    end
  end
  record(source, "POST", url, last)
  if not last then return nil, "not-reached" end
  return last
end

-- A JSON answer as a table, or nil and "key-refused" or "not-reached".
function M.decode(res, err)
  if type(res) ~= "table" then return nil, err or "not-reached" end
  if res.status == 401 or res.status == 403 then return nil, "key-refused" end
  if res.status ~= 200 or type(res.body) ~= "string" then return nil, "not-reached" end
  local ok, data = pcall(json.decode, res.body)
  if not ok or type(data) ~= "table" then return nil, "not-reached" end
  return data
end

local wininet

-- Windows: a download through WinINet, since Millennium's http cuts a binary body at its first zero byte.
local function binary_windows(url)
  local ok_ffi, ffi = pcall(require, "ffi")
  if not ok_ffi then return nil, "not-supported" end
  if wininet == nil then
    pcall(ffi.cdef, [[
      void* InternetOpenA(const char*, unsigned long, const char*, const char*, unsigned long);
      void* InternetOpenUrlA(void*, const char*, const char*, unsigned long, unsigned long, uintptr_t);
      int InternetReadFile(void*, void*, unsigned long, unsigned long*);
      int InternetCloseHandle(void*);
      int InternetSetOptionA(void*, unsigned long, void*, unsigned long);
      int HttpQueryInfoA(void*, unsigned long, void*, unsigned long*, unsigned long*);
    ]])
    local ok, lib = pcall(ffi.load, "wininet")
    wininet = ok and lib or false
  end
  if not wininet then return nil, "not-supported" end
  local session = wininet.InternetOpenA("jmcartridges/1.0", 0, nil, nil, 0)
  if session == nil then return nil, "not-reached" end
  local timeout = ffi.new("unsigned long[1]", M.TIMEOUT * 1000)
  wininet.InternetSetOptionA(session, 2, timeout, 4)
  wininet.InternetSetOptionA(session, 6, timeout, 4)
  local request = wininet.InternetOpenUrlA(session, url, nil, 0, 0x80000000 + 0x04000000 + 0x00080000 + 0x00000200, 0)
  if request == nil then
    wininet.InternetCloseHandle(session)
    return nil, "not-reached"
  end
  local text, len = ffi.new("char[32]"), ffi.new("unsigned long[1]", 32)
  local status = wininet.HttpQueryInfoA(request, 19, text, len, nil) ~= 0 and tonumber(ffi.string(text, len[0])) or 0
  local parts, total = {}, 0
  local buf, n = ffi.new("uint8_t[65536]"), ffi.new("unsigned long[1]")
  local broken = false
  while true do
    if wininet.InternetReadFile(request, buf, 65536, n) == 0 then
      broken = true
      break
    end
    if n[0] == 0 then break end
    total = total + n[0]
    if total > M.MAX_BYTES then break end
    parts[#parts + 1] = ffi.string(buf, n[0])
  end
  wininet.InternetCloseHandle(request)
  wininet.InternetCloseHandle(session)
  if broken then return nil, "not-reached" end
  if total > M.MAX_BYTES then return nil, "too-large" end
  return { status = status, body = table.concat(parts) }
end

-- Elsewhere: a download through curl into a temporary file.
local function binary_curl(url)
  if not url:match("^[%w%-%._~:/%?#%[%]@!%$&%(%)%*%+,;=%%]+$") then return nil, "bad-link" end
  local path = os.tmpname()
  local cmd = string.format("curl -s -L --max-redirs 5 --max-time %d --max-filesize %d -o '%s' -w '%%{http_code}' '%s' 2>/dev/null", M.TIMEOUT * 2, M.MAX_BYTES, path, url)
  local p = io.popen(cmd, "r")
  local status = p and tonumber(p:read("*a")) or 0
  if p then p:close() end
  local f = io.open(path, "rb")
  local body = f and f:read("*a")
  if f then f:close() end
  os.remove(path)
  if not body or status == 0 then return nil, "not-reached" end
  return { status = status, body = body }
end

-- A file's bytes: { status, body } or nil, reason.
function M.binary(source, url)
  if is_paused(source) then return nil, "paused" end
  local fetch = M.deps.binary or (package.config:sub(1, 1) == "\\" and binary_windows or binary_curl)
  local ok, res, err = pcall(fetch, url)
  if not ok then res, err = nil, res end
  -- A file over the size limit says nothing about the source being down.
  if err ~= "too-large" then record(source, "GET", url, res, err) end
  if type(res) ~= "table" then return nil, err or "not-reached" end
  return res
end

function M.encode(s)
  return (tostring(s):gsub("([^%w%-_%.~])", function(c) return string.format("%%%02X", c:byte()) end))
end

return M
