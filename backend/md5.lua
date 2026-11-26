-- MD5 of data handed over in pieces: Windows' own on Windows, plain Lua elsewhere.
local bit = require("bit")

local M = {}

-- Tests turn the Windows path off to check the Lua one.
M.deps = { native = true }

local band, bor, bxor, bnot, lshift, rshift, rol, tobit = bit.band, bit.bor, bit.bxor, bit.bnot, bit.lshift, bit.rshift, bit.rol, bit.tobit
local byte, char = string.byte, string.char

local K, S = {}, {}
for i = 0, 63 do K[i] = tobit(math.floor(math.abs(math.sin(i + 1)) * 4294967296)) end
for i, row in ipairs({ { 7, 12, 17, 22 }, { 5, 9, 14, 20 }, { 4, 11, 16, 23 }, { 6, 10, 15, 21 } }) do
  for n = 0, 15 do S[(i - 1) * 16 + n] = row[n % 4 + 1] end
end

-- One 64-byte block of `s` starting at `p` into the state `h`.
local function block(h, s, p)
  local m = {}
  for i = 0, 15 do
    local a, b, c, d = byte(s, p + i * 4, p + i * 4 + 3)
    m[i] = bor(a, lshift(b, 8), lshift(c, 16), lshift(d, 24))
  end
  local a, b, c, d = h[1], h[2], h[3], h[4]
  for i = 0, 63 do
    local f, g
    if i < 16 then
      f, g = bor(band(b, c), band(bnot(b), d)), i
    elseif i < 32 then
      f, g = bor(band(d, b), band(bnot(d), c)), (5 * i + 1) % 16
    elseif i < 48 then
      f, g = bxor(b, c, d), (3 * i + 5) % 16
    else
      f, g = bxor(c, bor(b, bnot(d))), (7 * i) % 16
    end
    local t = d
    d, c = c, b
    b = tobit(b + rol(tobit(a + f + K[i] + m[g]), S[i]))
    a = t
  end
  h[1], h[2], h[3], h[4] = tobit(h[1] + a), tobit(h[2] + b), tobit(h[3] + c), tobit(h[4] + d)
end

local function word(v)
  return char(band(v, 255), band(rshift(v, 8), 255), band(rshift(v, 16), 255), band(rshift(v, 24), 255))
end

local function hex(s)
  return (s:gsub(".", function(c) return string.format("%02x", byte(c)) end))
end

-- The plain Lua hasher: { add(piece), done() -> 32 hex digits }.
local function lua_hasher()
  local h = { 0x67452301, tobit(0xefcdab89), tobit(0x98badcfe), 0x10325476 }
  local rest, total = "", 0
  local self = {}
  function self.add(piece)
    total = total + #piece
    local s = rest .. piece
    local p = 1
    while p + 63 <= #s do
      block(h, s, p)
      p = p + 64
    end
    rest = s:sub(p)
  end
  function self.done()
    local bits = total * 8
    local s = rest .. "\128" .. string.rep("\0", (55 - #rest) % 64) .. word(tobit(bits % 4294967296)) .. word(tobit(math.floor(bits / 4294967296)))
    for p = 1, #s, 64 do block(h, s, p) end
    return hex(word(h[1]) .. word(h[2]) .. word(h[3]) .. word(h[4]))
  end
  return self
end

local advapi

-- Windows' hasher in the same shape, or nil when it cannot be had.
local function windows_hasher()
  if package.config:sub(1, 1) ~= "\\" or not M.deps.native then return nil end
  local ok_ffi, ffi = pcall(require, "ffi")
  if not ok_ffi then return nil end
  if advapi == nil then
    pcall(ffi.cdef, [[
      int CryptAcquireContextA(uintptr_t*, const char*, const char*, unsigned long, unsigned long);
      int CryptCreateHash(uintptr_t, unsigned int, uintptr_t, unsigned long, uintptr_t*);
      int CryptHashData(uintptr_t, const char*, unsigned long, unsigned long);
      int CryptGetHashParam(uintptr_t, unsigned long, uint8_t*, unsigned long*, unsigned long);
      int CryptDestroyHash(uintptr_t);
      int CryptReleaseContext(uintptr_t, unsigned long);
    ]])
    local ok, lib = pcall(ffi.load, "advapi32")
    advapi = ok and lib or false
  end
  if not advapi then return nil end
  local prov, hash = ffi.new("uintptr_t[1]"), ffi.new("uintptr_t[1]")
  if advapi.CryptAcquireContextA(prov, nil, nil, 1, 0xF0000000) == 0 then return nil end
  if advapi.CryptCreateHash(prov[0], 0x8003, 0, 0, hash) == 0 then
    advapi.CryptReleaseContext(prov[0], 0)
    return nil
  end
  local failed = false
  local self = {}
  function self.add(piece)
    if #piece > 0 and advapi.CryptHashData(hash[0], piece, #piece, 0) == 0 then failed = true end
  end
  function self.done()
    local out, len = ffi.new("uint8_t[16]"), ffi.new("unsigned long[1]", 16)
    local got = advapi.CryptGetHashParam(hash[0], 2, out, len, 0) ~= 0
    advapi.CryptDestroyHash(hash[0])
    advapi.CryptReleaseContext(prov[0], 0)
    if failed or not got then return nil end
    return hex(ffi.string(out, 16))
  end
  return self
end

function M.new()
  local ok, native = pcall(windows_hasher)
  return ok and native or lua_hasher()
end

function M.of(s)
  local h = M.new()
  h.add(s)
  return h.done()
end

return M
