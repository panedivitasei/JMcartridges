-- The ROM a shortcut starts, the consoles it can belong to, and the hash RetroAchievements knows a ROM by.
local md5 = require("md5")

local M = {}

-- RetroAchievements hashes at most this much of a file.
M.MAX_HASHED = 64 * 1024 * 1024

-- RetroAchievements' console numbers.
local C = {
  genesis = 1, n64 = 2, snes = 3, gb = 4, gba = 5, gbc = 6, nes = 7, pce = 8, segacd = 9, s32x = 10, sms = 11, psx = 12, lynx = 13, ngp = 14,
  gg = 15, gc = 16, jaguar = 17, nds = 18, wii = 19, ps2 = 21, pokemini = 24, a2600 = 25, arcade = 27, vb = 28, msx = 29, sg1000 = 33,
  saturn = 39, dc = 40, psp = 41, p3do = 43, coleco = 44, intv = 45, vectrex = 46, a7800 = 51, wswan = 53, neocd = 56, pcecd = 76, dsi = 78, fds = 81,
}

-- A file ending and the consoles it can be, likeliest first; one console means the ending settles it.
local BY_ENDING = {
  gba = { C.gba }, gbc = { C.gbc }, gb = { C.gb }, nes = { C.nes }, fds = { C.fds }, sfc = { C.snes }, smc = { C.snes },
  n64 = { C.n64 }, z64 = { C.n64 }, v64 = { C.n64 }, md = { C.genesis }, gen = { C.genesis }, ["32x"] = { C.s32x }, sms = { C.sms },
  gg = { C.gg }, pce = { C.pce }, sgx = { C.pce }, lnx = { C.lynx }, ngp = { C.ngp }, ngc = { C.ngp }, vb = { C.vb }, ws = { C.wswan },
  wsc = { C.wswan }, a26 = { C.a2600 }, a78 = { C.a7800 }, j64 = { C.jaguar }, jag = { C.jaguar }, col = { C.coleco }, int = { C.intv },
  vec = { C.vectrex }, sg = { C.sg1000 }, min = { C.pokemini }, nds = { C.nds }, dsi = { C.dsi }, gdi = { C.dc }, cdi = { C.dc },
  cso = { C.psp }, pbp = { C.psp, C.psx }, gcm = { C.gc }, gcz = { C.gc, C.wii }, rvz = { C.gc, C.wii }, wbfs = { C.wii }, wad = { C.wii },
  ciso = { C.gc, C.wii }, mx1 = { C.msx }, mx2 = { C.msx },
  -- Endings many consoles share: the folder, the core and the emulator say which.
  iso = {}, chd = {}, cue = {}, bin = {}, img = {}, ccd = {}, m3u = {}, zip = {}, ["7z"] = {},
}

-- Consoles whose hash is the MD5 of the file, after the header some of them carry.
local HASHED = {
  [C.gba] = true, [C.gbc] = true, [C.gb] = true, [C.nes] = true, [C.fds] = true, [C.snes] = true, [C.n64] = true, [C.genesis] = true,
  [C.s32x] = true, [C.sms] = true, [C.gg] = true, [C.pce] = true, [C.lynx] = true, [C.ngp] = true, [C.vb] = true, [C.wswan] = true,
  [C.a2600] = true, [C.a7800] = true, [C.jaguar] = true, [C.coleco] = true, [C.intv] = true, [C.vectrex] = true, [C.sg1000] = true,
  [C.pokemini] = true, [C.msx] = true,
}

-- A folder's, a libretro core's or an emulator's name, and the consoles it means; a name of four letters or more may be the start of a longer one.
local HINTS = {
  gamecube = { C.gc }, ngc = { C.gc }, gc = { C.gc }, dolphin = { C.gc, C.wii }, wii = { C.wii }, nintendowii = { C.wii },
  ps2 = { C.ps2 }, pcsx2 = { C.ps2 }, playstation2 = { C.ps2 }, lrps2 = { C.ps2 }, psp = { C.psp }, ppsspp = { C.psp },
  playstationportable = { C.psp }, psx = { C.psx }, ps1 = { C.psx }, playstation = { C.psx }, playstation1 = { C.psx },
  duckstation = { C.psx }, swanstation = { C.psx }, pcsx = { C.psx }, epsxe = { C.psx }, dreamcast = { C.dc }, segadreamcast = { C.dc },
  dc = { C.dc }, flycast = { C.dc }, redream = { C.dc }, saturn = { C.saturn }, segasaturn = { C.saturn }, yabause = { C.saturn },
  kronos = { C.saturn }, yabasanshiro = { C.saturn }, segacd = { C.segacd }, megacd = { C.segacd }, sega32x = { C.s32x },
  pcenginecd = { C.pcecd }, tgcd = { C.pcecd }, turbografxcd = { C.pcecd }, pcengine = { C.pce, C.pcecd }, pce = { C.pce, C.pcecd },
  tg16 = { C.pce, C.pcecd }, turbografx = { C.pce, C.pcecd }, supergrafx = { C.pce }, ["3do"] = { C.p3do }, opera = { C.p3do },
  neogeocd = { C.neocd }, neocd = { C.neocd }, arcade = { C.arcade }, mame = { C.arcade }, fbneo = { C.arcade }, fbalpha = { C.arcade },
  neogeo = { C.arcade }, snes = { C.snes }, sfc = { C.snes }, bsnes = { C.snes }, superfamicom = { C.snes }, supernintendo = { C.snes },
  n64 = { C.n64 }, nintendo64 = { C.n64 }, mupen64 = { C.n64 }, project64 = { C.n64 }, simple64 = { C.n64 }, parallel = { C.n64 },
  gba = { C.gba }, gameboyadvance = { C.gba }, mgba = { C.gba, C.gbc, C.gb }, vbam = { C.gba, C.gbc, C.gb }, gbc = { C.gbc },
  gameboycolor = { C.gbc }, gambatte = { C.gbc, C.gb }, sameboy = { C.gbc, C.gb }, gameboy = { C.gb, C.gbc }, gb = { C.gb, C.gbc },
  nds = { C.nds }, nintendods = { C.nds }, melonds = { C.nds }, desmume = { C.nds }, megadrive = { C.genesis }, segagenesis = { C.genesis },
  md = { C.genesis }, genesis = { C.genesis, C.sms, C.gg, C.segacd }, picodrive = { C.genesis, C.sms, C.s32x, C.segacd },
  mastersystem = { C.sms }, segamastersystem = { C.sms }, sms = { C.sms }, gamegear = { C.gg }, segagamegear = { C.gg }, gg = { C.gg },
  famicom = { C.nes }, nes = { C.nes }, nintendoentertainmentsystem = { C.nes }, fceumm = { C.nes }, nestopia = { C.nes }, mesen = { C.nes },
  atari2600 = { C.a2600 }, stella = { C.a2600 }, atari7800 = { C.a7800 }, prosystem = { C.a7800 }, lynx = { C.lynx }, atarilynx = { C.lynx },
  handy = { C.lynx }, jaguar = { C.jaguar }, atarijaguar = { C.jaguar }, ngp = { C.ngp }, ngpc = { C.ngp }, neogeopocket = { C.ngp },
  wonderswan = { C.wswan }, wswan = { C.wswan }, virtualboy = { C.vb }, msx = { C.msx }, colecovision = { C.coleco },
  intellivision = { C.intv }, vectrex = { C.vectrex },
}

-- Names a hint would be the start of that mean another console.
local NOT_A_HINT = { wiiu = true }

local function ending(path)
  return (tostring(path):match("%.([%w]+)$") or ""):lower()
end

-- The words of a command line: quoted runs and bare runs.
local function words(text)
  local out = {}
  local s = tostring(text or "")
  local p = 1
  while p <= #s do
    local a, b, quoted = s:find('^%s*"([^"]*)"', p)
    if not a then a, b, quoted = s:find("^%s*(%S+)", p) end
    if not a then break end
    out[#out + 1] = quoted
    p = b + 1
  end
  return out
end

-- The names in a path that can say a console: each folder or file name squashed to its letters and digits, then its words; nearest the end first.
local function names_in(path, out)
  local parts = {}
  for part in tostring(path):gmatch("[^\\/]+") do parts[#parts + 1] = part:lower() end
  for i = #parts, 1, -1 do
    out[#out + 1] = (parts[i]:gsub("%.%w+$", ""):gsub("[^%w]", ""))
    for word in parts[i]:gmatch("%w+") do out[#out + 1] = word end
  end
end

-- What a shortcut starts: { path, ending, names } with the ROM it names, or nil when it names none.
function M.find(exe, options)
  local path
  local rest = {}
  for _, word in ipairs(words(options)) do
    if BY_ENDING[ending(word)] then
      if path then rest[#rest + 1] = path end
      path = word
    else
      rest[#rest + 1] = word
    end
  end
  local program = words(exe)[1] or ""
  if not path and BY_ENDING[ending(program)] then path, program = program, "" end
  if not path then return nil end
  -- The folders above the ROM come first, then the rest of the command, then the program.
  local names = {}
  names_in(path:gsub("[^\\/]*$", ""), names)
  for _, word in ipairs(rest) do names_in(word, names) end
  names_in(program, names)
  return { path = path, ending = ending(path), names = names }
end

-- The consoles a name means: the longest hint it is, or starts with.
local function hinted(name)
  if NOT_A_HINT[name] then return nil end
  if HINTS[name] then return HINTS[name] end
  for length = #name - 1, 4, -1 do
    local hint = HINTS[name:sub(1, length)]
    if hint then return hint end
  end
  return nil
end

-- The consoles the ROM can belong to, likeliest first.
function M.consoles(found)
  local settled = BY_ENDING[found.ending] or {}
  if #settled == 1 then return { settled[1] } end
  local allowed
  if #settled > 0 then
    allowed = {}
    for _, id in ipairs(settled) do allowed[id] = true end
  end
  local out, seen = {}, {}
  local function add(list)
    for _, id in ipairs(list) do
      if not seen[id] and (not allowed or allowed[id]) then
        seen[id] = true
        out[#out + 1] = id
      end
    end
  end
  for _, name in ipairs(found.names) do add(hinted(name) or {}) end
  -- An ending that allows a few consoles lists the ones no name spoke for after the others.
  add(settled)
  return out
end

-- Is the console one whose ROM is hashed here, and the ending one that settles the console.
function M.hashable(found, console)
  local settled = BY_ENDING[found.ending] or {}
  return #settled == 1 and settled[1] == console and HASHED[console] == true
end

local function swap(s, size)
  return (s:gsub(string.rep(".", size), string.reverse))
end

-- The part of the file RetroAchievements hashes for the console, given the file's first bytes and size: skip, and a rewrite of each piece or nil.
local function rule(console, head, size)
  if console == C.nes or console == C.fds then
    if head:sub(1, 4) == "NES\26" or head:sub(1, 4) == "FDS\26" then return 16 end
  elseif console == C.snes then
    if size % 1024 == 512 then return 512 end
  elseif console == C.pce then
    if size % 131072 == 512 then return 512 end
  elseif console == C.lynx then
    if head:sub(1, 5) == "LYNX\0" then return 64 end
  elseif console == C.a7800 then
    if head:sub(2, 10) == "ATARI7800" then return 128 end
  elseif console == C.n64 then
    -- Byte-swapped and little-endian dumps are hashed as the big-endian ROM they hold.
    local first = head:byte(1)
    if first == 0x37 then return 0, function(piece) return swap(piece, 2) end end
    if first == 0x40 then return 0, function(piece) return swap(piece, 4) end end
  end
  return 0
end

-- The ROM's hash as RetroAchievements computes it, or nil when the file cannot be read.
function M.hash(path, console)
  local f = io.open(path, "rb")
  if not f then return nil end
  local size = f:seek("end") or 0
  f:seek("set", 0)
  local head = f:read(16) or ""
  local skip, rewrite = rule(console, head, size)
  f:seek("set", skip)
  local h = md5.new()
  local left = M.MAX_HASHED
  while left > 0 do
    -- Pieces stay a multiple of four bytes, so a swap never straddles two of them.
    local piece = f:read(math.min(left, 1024 * 1024))
    if not piece or #piece == 0 then break end
    left = left - #piece
    h.add(rewrite and rewrite(piece) or piece)
  end
  f:close()
  return h.done()
end

return M
