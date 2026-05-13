/**
 * Halls of the Forgotten — deterministic, turn-based roguelike core.
 *
 * The browser UI is deliberately thin; all world mutation goes through this
 * module so saves are one JSON blob and tests can run headless.
 */
export const MAP_W = 128
export const MAP_H = 128
export const VIEW_W = 48
export const VIEW_H = 32
export const FOV_RADIUS = 8

export const TILE = Object.freeze({ WALL: 0, FLOOR: 1 })

const MAX_ROOMS = 52
const INVENTORY_LIMIT = 18

const MONSTER_TYPES = [
  { kind: 'rat', name: 'Ash rat', glyph: 'r', hp: 4, attack: 2, defense: 0, xp: 2, awake: 7 },
  { kind: 'goblin', name: 'Lantern goblin', glyph: 'g', hp: 7, attack: 3, defense: 1, xp: 4, awake: 9 },
  { kind: 'mold', name: 'Memory mold', glyph: 'm', hp: 10, attack: 2, defense: 2, xp: 5, awake: 5 },
  { kind: 'wraith', name: 'Pale wraith', glyph: 'w', hp: 9, attack: 5, defense: 1, xp: 8, awake: 11 },
  { kind: 'sentinel', name: 'Broken sentinel', glyph: 'S', hp: 14, attack: 5, defense: 3, xp: 10, awake: 8 },
]

const ITEM_TABLE = [
  { type: 'potion', kind: 'healing', glyph: '!', weight: 10 },
  { type: 'potion', kind: 'strength', glyph: '!', weight: 4 },
  { type: 'potion', kind: 'clarity', glyph: '!', weight: 4 },
  { type: 'potion', kind: 'poison', glyph: '!', weight: 3 },
  { type: 'scroll', kind: 'mapping', glyph: '?', weight: 6 },
  { type: 'scroll', kind: 'phase', glyph: '?', weight: 5 },
  { type: 'scroll', kind: 'flame', glyph: '?', weight: 4 },
  { type: 'scroll', kind: 'sleep', glyph: '?', weight: 4 },
  { type: 'food', kind: 'ration', glyph: '%', weight: 8 },
  { type: 'weapon', kind: 'iron dagger', glyph: ')', weight: 3 },
  { type: 'armor', kind: 'patched cloak', glyph: '[', weight: 3 },
]

const POTION_ALIASES = ['amber', 'black', 'cloudy', 'silver', 'violet']
const SCROLL_ALIASES = ['KIR UTHA', 'MOR DEI', 'SAN VEL', 'OTH NIM', 'RAH DUN']

export function normalizeSeed(seed = Date.now()) {
  const n = Number(seed)
  if (!Number.isFinite(n)) return 0x5eed1234
  return (Math.trunc(n) >>> 0) || 0x5eed1234
}

export function rand(game) {
  // xorshift32; the mutable state is part of the save blob.
  let x = game.rngState >>> 0
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  game.rngState = x >>> 0
  return game.rngState / 0x100000000
}

function int(game, min, max) {
  return min + Math.floor(rand(game) * (max - min + 1))
}

function oneOf(game, arr) {
  return arr[Math.floor(rand(game) * arr.length)]
}

function weighted(game, rows) {
  const total = rows.reduce((sum, row) => sum + row.weight, 0)
  let roll = rand(game) * total
  for (const row of rows) {
    roll -= row.weight
    if (roll <= 0) return row
  }
  return rows[rows.length - 1]
}

function shuffle(game, arr) {
  const copy = arr.slice()
  for (let i = copy.length - 1; i > 0; i--) {
    const j = int(game, 0, i)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function xy(x, y) {
  return y * MAP_W + x
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < MAP_W && y < MAP_H
}

export function tileAt(game, x, y) {
  if (!inBounds(x, y)) return TILE.WALL
  return game.map[xy(x, y)] ?? TILE.WALL
}

function setTile(game, x, y, tile) {
  if (inBounds(x, y)) game.map[xy(x, y)] = tile
}

function isFloor(game, x, y) {
  return tileAt(game, x, y) === TILE.FLOOR
}

function carveRoom(game, room) {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) setTile(game, x, y, TILE.FLOOR)
  }
}

function carveCorridor(game, a, b) {
  const horizontalFirst = rand(game) < 0.5
  const digH = (x1, x2, y) => {
    for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) setTile(game, x, y, TILE.FLOOR)
  }
  const digV = (y1, y2, x) => {
    for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) setTile(game, x, y, TILE.FLOOR)
  }
  if (horizontalFirst) {
    digH(a.cx, b.cx, a.cy)
    digV(a.cy, b.cy, b.cx)
  } else {
    digV(a.cy, b.cy, a.cx)
    digH(a.cx, b.cx, b.cy)
  }
}

function overlaps(a, b) {
  return a.x - 1 < b.x + b.w && a.x + a.w + 1 > b.x && a.y - 1 < b.y + b.h && a.y + a.h + 1 > b.y
}

function addLog(game, text, tone = 'normal') {
  game.log.push({ turn: game.turn, text, tone })
  if (game.log.length > 80) game.log.splice(0, game.log.length - 80)
}

function makeIdentifications(game) {
  const potionNames = shuffle(game, POTION_ALIASES)
  const scrollNames = shuffle(game, SCROLL_ALIASES)
  return {
    potionNames: {
      healing: potionNames[0],
      strength: potionNames[1],
      clarity: potionNames[2],
      poison: potionNames[3],
    },
    scrollNames: {
      mapping: scrollNames[0],
      phase: scrollNames[1],
      flame: scrollNames[2],
      sleep: scrollNames[3],
    },
    known: {
      potion: { healing: false, strength: false, clarity: false, poison: false },
      scroll: { mapping: false, phase: false, flame: false, sleep: false },
    },
  }
}

export function createGame(options = {}) {
  const seed = normalizeSeed(options.seed)
  const echoes = Math.max(0, Math.floor(options.meta?.echoes ?? 0))
  const maxHp = 24 + Math.min(12, Math.floor(Math.sqrt(echoes)))
  const game = {
    version: 1,
    seed,
    rngState: seed,
    floor: 1,
    turn: 0,
    nextId: 1,
    map: new Array(MAP_W * MAP_H).fill(TILE.WALL),
    explored: new Array(MAP_W * MAP_H).fill(false),
    visible: new Array(MAP_W * MAP_H).fill(false),
    rooms: [],
    stairs: { x: 1, y: 1 },
    player: {
      x: 1,
      y: 1,
      glyph: '@',
      hp: maxHp,
      maxHp,
      attack: 4,
      defense: 1,
      level: 1,
      xp: 0,
      hunger: 240,
      echoShards: 0,
      effects: [],
      weapon: null,
      armor: null,
    },
    monsters: [],
    items: [],
    inventory: [],
    ident: null,
    log: [],
    dead: false,
    won: false,
    metaAwarded: false,
  }
  game.ident = makeIdentifications(game)
  generateLevel(game, false)
  addLog(game, 'You wake beneath the Halls of the Forgotten.', 'good')
  addLog(game, 'Find echo shards, identify strange relics, and descend when ready.')
  return game
}

function makeRoom(game) {
  const w = int(game, 5, 14)
  const h = int(game, 4, 10)
  const x = int(game, 2, MAP_W - w - 3)
  const y = int(game, 2, MAP_H - h - 3)
  return { x, y, w, h, cx: x + Math.floor(w / 2), cy: y + Math.floor(h / 2) }
}

function generateLevel(game, keepPlayer) {
  game.map = new Array(MAP_W * MAP_H).fill(TILE.WALL)
  game.explored = new Array(MAP_W * MAP_H).fill(false)
  game.visible = new Array(MAP_W * MAP_H).fill(false)
  game.rooms = []
  game.monsters = []
  game.items = []

  for (let tries = 0; tries < 900 && game.rooms.length < MAX_ROOMS; tries++) {
    const room = makeRoom(game)
    if (game.rooms.some((r) => overlaps(room, r))) continue
    carveRoom(game, room)
    const previous = game.rooms[game.rooms.length - 1]
    if (previous) carveCorridor(game, previous, room)
    game.rooms.push(room)
  }

  if (game.rooms.length === 0) throw new Error('failed to generate dungeon')
  const start = game.rooms[0]
  game.player.x = start.cx
  game.player.y = start.cy
  const end = game.rooms[game.rooms.length - 1]
  game.stairs = { x: end.cx, y: end.cy }

  const occupied = new Set([`${game.player.x},${game.player.y}`, `${game.stairs.x},${game.stairs.y}`])
  const reserve = (minPlayerDistance = 0) => randomFloor(game, occupied, minPlayerDistance)

  const monsterCount = Math.min(52, 24 + game.floor * 5)
  for (let i = 0; i < monsterCount; i++) {
    const pos = reserve(FOV_RADIUS + 2)
    if (!pos) break
    const depthBias = Math.min(MONSTER_TYPES.length - 1, Math.floor((game.floor + rand(game) * 3) / 2))
    const type = MONSTER_TYPES[int(game, 0, depthBias)]
    game.monsters.push({
      id: game.nextId++,
      ...type,
      hp: type.hp + game.floor * 2,
      maxHp: type.hp + game.floor * 2,
      x: pos.x,
      y: pos.y,
      asleep: rand(game) < 0.18,
      effects: [],
    })
  }

  const itemCount = 26 + game.floor * 2
  for (let i = 0; i < itemCount; i++) {
    const pos = reserve(4)
    if (!pos) break
    spawnItem(game, pos.x, pos.y, weighted(game, ITEM_TABLE))
  }
  for (let i = 0; i < 6 + game.floor; i++) {
    const pos = reserve(6)
    if (!pos) break
    spawnItem(game, pos.x, pos.y, { type: 'shard', kind: 'echo shard', glyph: '*', weight: 1 })
  }

  if (keepPlayer) addLog(game, `You descend to floor ${game.floor}. The halls rearrange around you.`, 'good')
  computeFov(game)
}

function randomFloor(game, occupied, minPlayerDistance) {
  for (let i = 0; i < 3000; i++) {
    const room = oneOf(game, game.rooms)
    const x = int(game, room.x, room.x + room.w - 1)
    const y = int(game, room.y, room.y + room.h - 1)
    const key = `${x},${y}`
    if (occupied.has(key)) continue
    if (Math.abs(x - game.player.x) + Math.abs(y - game.player.y) < minPlayerDistance) continue
    if (!isFloor(game, x, y)) continue
    occupied.add(key)
    return { x, y }
  }
  return null
}

function spawnItem(game, x, y, def) {
  game.items.push({ id: game.nextId++, type: def.type, kind: def.kind, glyph: def.glyph, x, y })
}

export function serializeGame(game) {
  return JSON.stringify(game)
}

export function restoreGame(blob) {
  const game = typeof blob === 'string' ? JSON.parse(blob) : structuredClone(blob)
  if (!game.version) throw new Error('Unsupported save file')
  game.visible = new Array(MAP_W * MAP_H).fill(false)
  computeFov(game)
  return game
}

function lineClear(game, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0)
  let sx = x0 < x1 ? 1 : -1
  let dy = -Math.abs(y1 - y0)
  let sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  let x = x0
  let y = y0
  while (true) {
    if (x === x1 && y === y1) return true
    const e2 = 2 * err
    if (e2 >= dy) {
      err += dy
      x += sx
    }
    if (e2 <= dx) {
      err += dx
      y += sy
    }
    if (x === x1 && y === y1) return true
    if (tileAt(game, x, y) === TILE.WALL) return false
  }
}

export function computeFov(game) {
  game.visible.fill(false)
  const { x: px, y: py } = game.player
  for (let y = py - FOV_RADIUS; y <= py + FOV_RADIUS; y++) {
    for (let x = px - FOV_RADIUS; x <= px + FOV_RADIUS; x++) {
      if (!inBounds(x, y)) continue
      const d2 = (x - px) ** 2 + (y - py) ** 2
      if (d2 > FOV_RADIUS ** 2) continue
      if (!lineClear(game, px, py, x, y)) continue
      const i = xy(x, y)
      game.visible[i] = true
      game.explored[i] = true
    }
  }
}

export function visibleCount(game) {
  return game.visible.reduce((n, v) => n + (v ? 1 : 0), 0)
}

export function cameraOrigin(game) {
  const x = Math.max(0, Math.min(MAP_W - VIEW_W, game.player.x - Math.floor(VIEW_W / 2)))
  const y = Math.max(0, Math.min(MAP_H - VIEW_H, game.player.y - Math.floor(VIEW_H / 2)))
  return { x, y }
}

export function monsterAt(game, x, y) {
  return game.monsters.find((m) => m.hp > 0 && m.x === x && m.y === y) ?? null
}

export function itemAt(game, x, y) {
  const items = game.items.filter((i) => i.x === x && i.y === y)
  return items[items.length - 1] ?? null
}

function removeItem(game, item) {
  const idx = game.items.findIndex((i) => i.id === item.id)
  if (idx >= 0) game.items.splice(idx, 1)
}

function isOccupied(game, x, y) {
  return monsterAt(game, x, y) || (game.player.x === x && game.player.y === y)
}

function damageRoll(game, attack, defense) {
  return Math.max(1, attack + int(game, 0, 3) - defense)
}

function playerAttack(game, monster) {
  const bonus = game.player.weapon?.bonus ?? 0
  const dmg = damageRoll(game, game.player.attack + bonus, monster.defense)
  monster.hp -= dmg
  addLog(game, `You strike the ${monster.name} for ${dmg}.`)
  if (monster.hp <= 0) {
    addLog(game, `The ${monster.name} collapses.`, 'good')
    game.player.xp += monster.xp
    maybeDrop(game, monster.x, monster.y)
    levelCheck(game)
  }
}

function monsterAttack(game, monster) {
  const armor = game.player.armor?.bonus ?? 0
  const dmg = damageRoll(game, monster.attack, game.player.defense + armor)
  game.player.hp -= dmg
  addLog(game, `The ${monster.name} hits you for ${dmg}.`, 'bad')
  if (game.player.hp <= 0) die(game, `slain by ${monster.name}`)
}

function maybeDrop(game, x, y) {
  if (rand(game) < 0.12) spawnItem(game, x, y, { type: 'shard', kind: 'echo shard', glyph: '*', weight: 1 })
  else if (rand(game) < 0.08) spawnItem(game, x, y, weighted(game, ITEM_TABLE))
}

function levelCheck(game) {
  const needed = game.player.level * 14
  if (game.player.xp < needed) return
  game.player.xp -= needed
  game.player.level += 1
  game.player.maxHp += 5
  game.player.hp = game.player.maxHp
  game.player.attack += 1
  addLog(game, `You reach level ${game.player.level}. Memory sharpens into strength.`, 'good')
}

function die(game, cause) {
  game.dead = true
  game.deathCause = cause
  addLog(game, `You died: ${cause}. Your save is forfeit.`, 'bad')
}

export function itemDisplayName(game, item) {
  if (!item) return ''
  if (item.type === 'potion') {
    return game.ident.known.potion[item.kind]
      ? `potion of ${item.kind}`
      : `${game.ident.potionNames[item.kind]} potion`
  }
  if (item.type === 'scroll') {
    return game.ident.known.scroll[item.kind]
      ? `scroll of ${item.kind}`
      : `scroll labeled ${game.ident.scrollNames[item.kind]}`
  }
  return item.kind
}

export function itemTooltip(game, item) {
  if (!item) return ''
  const name = itemDisplayName(game, item)
  if (item.type === 'shard') return `${name}: meta-progression currency banked only when the run ends.`
  if (item.type === 'food') return `${name}: restores hunger.`
  if (item.type === 'weapon') return `${name}: +2 attack when equipped.`
  if (item.type === 'armor') return `${name}: +2 defense when equipped.`
  if (item.type === 'potion' && game.ident.known.potion[item.kind]) return `${name}: drink to invoke its known effect.`
  if (item.type === 'scroll' && game.ident.known.scroll[item.kind]) return `${name}: read to invoke its known effect.`
  return `${name}: unidentified. Use it to learn what it does.`
}

export function cellTooltip(game, x, y) {
  if (!inBounds(x, y)) return ''
  const i = xy(x, y)
  if (!game.explored[i]) return 'Unexplored darkness.'
  if (game.player.x === x && game.player.y === y) return `You\nHP ${game.player.hp}/${game.player.maxHp}\nHunger ${game.player.hunger}`
  const m = game.visible[i] ? monsterAt(game, x, y) : null
  if (m) return `${m.name}\nHP ${Math.max(0, m.hp)}/${m.maxHp}\nAttack ${m.attack} Defense ${m.defense}`
  const item = game.visible[i] ? itemAt(game, x, y) : null
  if (item) return itemTooltip(game, item)
  if (game.stairs.x === x && game.stairs.y === y) return 'A stairway down. Press > to descend.'
  return tileAt(game, x, y) === TILE.WALL ? 'Ancient wall.' : 'Stone floor.'
}

function addEffect(target, effect) {
  const existing = target.effects.find((e) => e.kind === effect.kind)
  if (existing) {
    existing.turns = Math.max(existing.turns, effect.turns)
    existing.power = Math.max(existing.power ?? 0, effect.power ?? 0)
  } else {
    target.effects.push(effect)
  }
}

function tickPlayerEffects(game) {
  for (const effect of game.player.effects) {
    if (effect.kind === 'poison') {
      game.player.hp -= effect.power ?? 1
      addLog(game, 'Poison burns through your veins.', 'bad')
    }
    if (effect.kind === 'regen') {
      game.player.hp = Math.min(game.player.maxHp, game.player.hp + (effect.power ?? 1))
    }
    effect.turns -= 1
  }
  game.player.effects = game.player.effects.filter((e) => e.turns > 0)
  if (game.player.hp <= 0) die(game, 'poisoned in the dark')
}

function tickMonsterEffects(monster) {
  for (const effect of monster.effects) effect.turns -= 1
  monster.effects = monster.effects.filter((e) => e.turns > 0)
}

function hasEffect(actor, kind) {
  return actor.effects.some((e) => e.kind === kind)
}

function monsterTurn(game, monster) {
  if (monster.hp <= 0) return
  tickMonsterEffects(monster)
  if (hasEffect(monster, 'sleep')) return
  const dx = game.player.x - monster.x
  const dy = game.player.y - monster.y
  const dist = Math.abs(dx) + Math.abs(dy)
  if (dist === 1) {
    monsterAttack(game, monster)
    return
  }
  if (monster.asleep && dist <= monster.awake) monster.asleep = false
  if (monster.asleep) return
  if (hasEffect(game.player, 'hidden') && rand(game) < 0.6) return
  let stepX = 0
  let stepY = 0
  if (dist <= monster.awake && lineClear(game, monster.x, monster.y, game.player.x, game.player.y)) {
    if (Math.abs(dx) > Math.abs(dy)) stepX = Math.sign(dx)
    else stepY = Math.sign(dy)
  } else if (rand(game) < 0.2) {
    stepX = int(game, -1, 1)
    stepY = stepX === 0 ? int(game, -1, 1) : 0
  }
  const nx = monster.x + stepX
  const ny = monster.y + stepY
  if ((stepX || stepY) && isFloor(game, nx, ny) && !isOccupied(game, nx, ny)) {
    monster.x = nx
    monster.y = ny
  }
}

function finishTurn(game) {
  if (game.dead || game.won) return
  game.turn += 1
  game.player.hunger -= 1
  tickPlayerEffects(game)
  if (game.dead) return
  if (game.player.hunger <= 0 && game.turn % 5 === 0) {
    game.player.hp -= 1
    addLog(game, 'Starvation gnaws at you.', 'bad')
    if (game.player.hp <= 0) die(game, 'starved')
  }
  for (const monster of game.monsters) {
    monsterTurn(game, monster)
    if (game.dead) break
  }
  game.monsters = game.monsters.filter((m) => m.hp > 0)
  computeFov(game)
}

export function movePlayer(game, dx, dy) {
  if (game.dead || game.won) return false
  if (dx === 0 && dy === 0) {
    addLog(game, 'You wait and listen.')
    finishTurn(game)
    return true
  }
  const nx = game.player.x + dx
  const ny = game.player.y + dy
  const monster = monsterAt(game, nx, ny)
  if (monster) {
    playerAttack(game, monster)
    finishTurn(game)
    return true
  }
  if (!isFloor(game, nx, ny)) {
    addLog(game, 'You run your hand along cold stone.')
    return false
  }
  game.player.x = nx
  game.player.y = ny
  const item = itemAt(game, nx, ny)
  if (item?.type === 'shard') {
    for (const shard of game.items.filter((i) => i.x === nx && i.y === ny && i.type === 'shard')) {
      game.player.echoShards += 1
      removeItem(game, shard)
      addLog(game, 'An echo shard dissolves into your memory.', 'good')
    }
  } else if (item) {
    addLog(game, `You see ${itemDisplayName(game, item)} here. Press g to take it.`)
  }
  finishTurn(game)
  return true
}

export function pickup(game) {
  if (game.dead || game.won) return false
  const here = game.items.filter((i) => i.x === game.player.x && i.y === game.player.y)
  if (here.length === 0) {
    addLog(game, 'There is nothing here to take.')
    return false
  }
  let took = false
  for (const item of here) {
    if (item.type === 'shard') {
      game.player.echoShards += 1
      removeItem(game, item)
      addLog(game, 'An echo shard dissolves into your memory.', 'good')
      took = true
      continue
    }
    if (game.inventory.length >= INVENTORY_LIMIT) {
      addLog(game, 'Your pack is full.', 'bad')
      break
    }
    removeItem(game, item)
    delete item.x
    delete item.y
    game.inventory.push(item)
    addLog(game, `You pick up ${itemDisplayName(game, item)}.`)
    took = true
  }
  if (took) finishTurn(game)
  return took
}

export function dropItem(game, index) {
  const item = game.inventory[index]
  if (!item) return false
  game.inventory.splice(index, 1)
  item.x = game.player.x
  item.y = game.player.y
  game.items.push(item)
  addLog(game, `You drop ${itemDisplayName(game, item)}.`)
  finishTurn(game)
  return true
}

export function useItem(game, index) {
  if (game.dead || game.won) return false
  const item = game.inventory[index]
  if (!item) return false
  let consumed = true
  if (item.type === 'food') {
    game.player.hunger = Math.min(260, game.player.hunger + 90)
    addLog(game, 'You eat the ration. The ache fades.', 'good')
  } else if (item.type === 'weapon') {
    game.player.weapon = { name: item.kind, bonus: 2 }
    addLog(game, `You equip the ${item.kind}.`, 'good')
    consumed = false
  } else if (item.type === 'armor') {
    game.player.armor = { name: item.kind, bonus: 2 }
    addLog(game, `You fasten the ${item.kind}.`, 'good')
    consumed = false
  } else if (item.type === 'potion') {
    game.ident.known.potion[item.kind] = true
    drinkPotion(game, item.kind)
  } else if (item.type === 'scroll') {
    game.ident.known.scroll[item.kind] = true
    readScroll(game, item.kind)
  } else {
    consumed = false
  }
  if (consumed) game.inventory.splice(index, 1)
  finishTurn(game)
  return true
}

function drinkPotion(game, kind) {
  if (kind === 'healing') {
    game.player.hp = Math.min(game.player.maxHp, game.player.hp + 16)
    addLog(game, 'Warmth knits your wounds. It was a potion of healing.', 'good')
  } else if (kind === 'strength') {
    addEffect(game.player, { kind: 'might', turns: 55, power: 2 })
    game.player.attack += 1
    addLog(game, 'Your hands steady. It was a potion of strength.', 'good')
  } else if (kind === 'clarity') {
    game.player.effects = game.player.effects.filter((e) => e.kind !== 'poison')
    addEffect(game.player, { kind: 'hidden', turns: 25, power: 1 })
    addLog(game, 'The map of the dark sharpens in your mind. It was clarity.', 'good')
  } else if (kind === 'poison') {
    addEffect(game.player, { kind: 'poison', turns: 8, power: 2 })
    addLog(game, 'Bitter fire floods your throat. It was poison!', 'bad')
  }
}

function readScroll(game, kind) {
  if (kind === 'mapping') {
    for (const room of game.rooms) {
      for (let y = room.y; y < room.y + room.h; y++) {
        for (let x = room.x; x < room.x + room.w; x++) game.explored[xy(x, y)] = true
      }
    }
    addLog(game, 'Ink crawls into a map of nearby halls.', 'good')
  } else if (kind === 'phase') {
    const occupied = new Set(game.monsters.map((m) => `${m.x},${m.y}`))
    const pos = randomFloor(game, occupied, 0)
    if (pos) {
      game.player.x = pos.x
      game.player.y = pos.y
      addLog(game, 'Space folds. You stumble elsewhere.', 'good')
    }
  } else if (kind === 'flame') {
    let hit = 0
    for (const monster of game.monsters) {
      if (Math.abs(monster.x - game.player.x) + Math.abs(monster.y - game.player.y) <= 5) {
        monster.hp -= 10
        hit += 1
      }
    }
    addLog(game, `Forgotten fire lashes ${hit} foe${hit === 1 ? '' : 's'}.`, hit ? 'good' : 'normal')
  } else if (kind === 'sleep') {
    let hit = 0
    for (const monster of game.monsters) {
      if (Math.abs(monster.x - game.player.x) + Math.abs(monster.y - game.player.y) <= 7) {
        addEffect(monster, { kind: 'sleep', turns: 8, power: 1 })
        hit += 1
      }
    }
    addLog(game, `A hush settles over ${hit} creature${hit === 1 ? '' : 's'}.`, hit ? 'good' : 'normal')
  }
}

export function descend(game) {
  if (game.dead || game.won) return false
  if (game.player.x !== game.stairs.x || game.player.y !== game.stairs.y) {
    addLog(game, 'There are no stairs here.')
    return false
  }
  if (game.floor >= 6) {
    game.won = true
    addLog(game, 'You carry a true memory out of the forgotten halls.', 'good')
    return true
  }
  game.floor += 1
  game.player.hunger = Math.max(90, game.player.hunger)
  generateLevel(game, true)
  finishTurn(game)
  return true
}

export function action(game, name, payload = {}) {
  if (name === 'move') return movePlayer(game, payload.dx ?? 0, payload.dy ?? 0)
  if (name === 'wait') return movePlayer(game, 0, 0)
  if (name === 'pickup') return pickup(game)
  if (name === 'use') return useItem(game, payload.index)
  if (name === 'drop') return dropItem(game, payload.index)
  if (name === 'descend') return descend(game)
  return false
}

export function deathReward(game) {
  return game.player.echoShards + Math.max(0, game.floor - 1) * 2 + (game.won ? 12 : 0)
}
