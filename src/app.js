import {
  MAP_W,
  MAP_H,
  VIEW_W,
  VIEW_H,
  TILE,
  action,
  cameraOrigin,
  cellTooltip,
  createGame,
  deathReward,
  itemAt,
  itemDisplayName,
  itemTooltip,
  monsterAt,
  restoreGame,
  serializeGame,
  tileAt,
  visibleCount,
} from './game.js'

const SAVE_KEY = 'halls_game.save.v1'
const META_KEY = 'halls_game.meta.v1'

const $ = (id) => document.getElementById(id)
const viewport = $('viewport')
const hud = $('hud')
const log = $('log')
const inventoryModal = $('inventory-modal')
const inventoryList = $('inventory-list')
const helpModal = $('help-modal')
const endModal = $('end-modal')
const endTitle = $('end-title')
const endBody = $('end-body')
const tooltip = $('tooltip')
const saveBlob = $('save-blob')

const cells = []
let game = null
let meta = loadMeta()

function loadMeta() {
  try {
    return { echoes: 0, totalRuns: 0, bestFloor: 1, ...JSON.parse(localStorage.getItem(META_KEY) ?? '{}') }
  } catch {
    return { echoes: 0, totalRuns: 0, bestFloor: 1 }
  }
}

function saveMeta() {
  localStorage.setItem(META_KEY, JSON.stringify(meta))
}

function loadInitialGame() {
  const saved = localStorage.getItem(SAVE_KEY)
  if (saved) {
    try {
      return restoreGame(saved)
    } catch (err) {
      console.warn('Save could not be restored:', err)
      localStorage.removeItem(SAVE_KEY)
    }
  }
  return createGame({ seed: Date.now(), meta })
}

function makeViewport() {
  viewport.style.gridTemplateColumns = `repeat(${VIEW_W}, 16px)`
  for (let i = 0; i < VIEW_W * VIEW_H; i++) {
    const cell = document.createElement('button')
    cell.type = 'button'
    cell.className = 'cell unexplored'
    cell.setAttribute('aria-label', 'unexplored')
    cell.addEventListener('mousemove', showTooltip)
    cell.addEventListener('mouseleave', hideTooltip)
    viewport.append(cell)
    cells.push(cell)
  }
}

function glyphForCell(x, y, visible, explored) {
  if (!explored) return ' '
  if (game.player.x === x && game.player.y === y) return '@'
  const monster = visible ? monsterAt(game, x, y) : null
  if (monster) return monster.glyph
  const item = visible ? itemAt(game, x, y) : null
  if (item) return item.glyph
  if (game.stairs.x === x && game.stairs.y === y) return '>'
  return tileAt(game, x, y) === TILE.WALL ? '#' : '·'
}

function classesForCell(x, y, visible, explored) {
  const classes = ['cell']
  if (!explored) classes.push('unexplored')
  else classes.push(tileAt(game, x, y) === TILE.WALL ? 'wall' : 'floor')
  if (visible) classes.push('visible')
  if (game.player.x === x && game.player.y === y) classes.push('player')
  else if (visible && monsterAt(game, x, y)) classes.push('monster')
  else if (visible && itemAt(game, x, y)) classes.push('item')
  if (game.stairs.x === x && game.stairs.y === y && explored) classes.push('stairs')
  return classes.join(' ')
}

function render() {
  const camera = cameraOrigin(game)
  for (let sy = 0; sy < VIEW_H; sy++) {
    for (let sx = 0; sx < VIEW_W; sx++) {
      const x = camera.x + sx
      const y = camera.y + sy
      const idx = y * MAP_W + x
      const visible = game.visible[idx]
      const explored = game.explored[idx]
      const cell = cells[sy * VIEW_W + sx]
      cell.textContent = glyphForCell(x, y, visible, explored)
      cell.className = classesForCell(x, y, visible, explored)
      cell.dataset.x = String(x)
      cell.dataset.y = String(y)
      cell.dataset.tip = cellTooltip(game, x, y)
      cell.setAttribute('aria-label', cell.dataset.tip.replaceAll('\n', ', '))
    }
  }
  renderHud()
  renderLog()
  if (!inventoryModal.hidden) renderInventory()
  saveBlob.value = serializeGame(game)
  maybeEndRun()
}

function renderHud() {
  const effects = game.player.effects.map((e) => `${e.kind}(${e.turns})`).join(', ') || 'none'
  const weapon = game.player.weapon ? `${game.player.weapon.name} (+${game.player.weapon.bonus})` : 'bare hands'
  const armor = game.player.armor ? `${game.player.armor.name} (+${game.player.armor.bonus})` : 'none'
  hud.innerHTML = `
    <dl>
      <div><dt>Floor</dt><dd>${game.floor}/6</dd></div>
      <div><dt>Turn</dt><dd>${game.turn}</dd></div>
      <div><dt>HP</dt><dd>${game.player.hp}/${game.player.maxHp}</dd></div>
      <div><dt>Level</dt><dd>${game.player.level} (${game.player.xp}/${game.player.level * 14} xp)</dd></div>
      <div><dt>Attack</dt><dd>${game.player.attack + (game.player.weapon?.bonus ?? 0)}</dd></div>
      <div><dt>Defense</dt><dd>${game.player.defense + (game.player.armor?.bonus ?? 0)}</dd></div>
      <div><dt>Hunger</dt><dd>${game.player.hunger}</dd></div>
      <div><dt>Echo shards</dt><dd>${game.player.echoShards}</dd></div>
      <div><dt>Banked echoes</dt><dd>${meta.echoes}</dd></div>
      <div><dt>Visible</dt><dd>${visibleCount(game)} tiles</dd></div>
    </dl>
    <p><b>Weapon:</b> ${escapeHtml(weapon)}</p>
    <p><b>Armor:</b> ${escapeHtml(armor)}</p>
    <p><b>Effects:</b> ${escapeHtml(effects)}</p>
    <p class="muted">Seed ${game.seed} · viewport ${VIEW_W}×${VIEW_H} over ${MAP_W}×${MAP_H}</p>
  `
}

function renderLog() {
  log.innerHTML = ''
  for (const entry of game.log.slice(-12)) {
    const line = document.createElement('li')
    line.className = entry.tone
    line.textContent = `[${entry.turn}] ${entry.text}`
    log.append(line)
  }
}

function renderInventory() {
  inventoryList.innerHTML = ''
  if (game.inventory.length === 0) {
    inventoryList.innerHTML = '<p class="muted">Your pack is empty.</p>'
    return
  }
  game.inventory.forEach((item, index) => {
    const row = document.createElement('div')
    row.className = 'inventory-row'
    row.innerHTML = `
      <div>
        <b>${escapeHtml(itemDisplayName(game, item))}</b>
        <p>${escapeHtml(itemTooltip(game, item))}</p>
      </div>
      <div class="row-actions">
        <button data-use="${index}">Use</button>
        <button data-drop="${index}">Drop</button>
      </div>
    `
    inventoryList.append(row)
  })
}

function tryAction(name, payload) {
  const changed = action(game, name, payload)
  if (changed) {
    if (!game.dead && !game.won) localStorage.setItem(SAVE_KEY, serializeGame(game))
    render()
  } else {
    renderLog()
  }
}

function maybeEndRun() {
  if ((!game.dead && !game.won) || game.metaAwarded) return
  const reward = deathReward(game)
  game.metaAwarded = true
  meta.echoes += reward
  meta.totalRuns += 1
  meta.bestFloor = Math.max(meta.bestFloor, game.floor)
  saveMeta()
  localStorage.removeItem(SAVE_KEY)
  endTitle.textContent = game.won ? 'You escaped the Halls' : 'Permadeath'
  endBody.innerHTML = `
    <p>${game.won ? 'A whole memory returns with you.' : `Cause: ${escapeHtml(game.deathCause ?? 'unknown')}`}</p>
    <p>Echoes banked from this run: <b>${reward}</b></p>
    <p>Total banked echoes: <b>${meta.echoes}</b>. Future runs start with bonus max HP.</p>
  `
  endModal.hidden = false
}

function newRun() {
  game = createGame({ seed: Date.now(), meta })
  localStorage.setItem(SAVE_KEY, serializeGame(game))
  endModal.hidden = true
  inventoryModal.hidden = true
  render()
}

function saveGame() {
  const blob = serializeGame(game)
  localStorage.setItem(SAVE_KEY, blob)
  saveBlob.value = blob
}

function loadGameFromTextOrStorage() {
  const blob = saveBlob.value.trim() || localStorage.getItem(SAVE_KEY)
  if (!blob) return
  try {
    game = restoreGame(blob)
    localStorage.setItem(SAVE_KEY, serializeGame(game))
    endModal.hidden = true
    inventoryModal.hidden = true
    render()
  } catch (err) {
    alert(`Could not load save: ${err.message}`)
  }
}

function showTooltip(event) {
  const text = event.currentTarget.dataset.tip
  if (!text) return
  tooltip.textContent = text
  tooltip.hidden = false
  const pad = 14
  tooltip.style.left = `${event.clientX + pad}px`
  tooltip.style.top = `${event.clientY + pad}px`
}

function hideTooltip() {
  tooltip.hidden = true
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
}

function bindUi() {
  $('new-run').addEventListener('click', newRun)
  $('save-run').addEventListener('click', saveGame)
  $('load-run').addEventListener('click', loadGameFromTextOrStorage)
  $('inventory').addEventListener('click', () => {
    inventoryModal.hidden = false
    renderInventory()
  })
  $('help').addEventListener('click', () => { helpModal.hidden = false })
  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', () => { $(button.dataset.close).hidden = true })
  })
  $('end-new-run').addEventListener('click', newRun)
  inventoryList.addEventListener('click', (event) => {
    const button = event.target.closest('button')
    if (!button) return
    if (button.dataset.use) tryAction('use', { index: Number(button.dataset.use) })
    if (button.dataset.drop) tryAction('drop', { index: Number(button.dataset.drop) })
  })
  document.addEventListener('keydown', onKey)
}

function onKey(event) {
  if (event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement) return
  if (!helpModal.hidden || !endModal.hidden) {
    if (event.key === 'Escape') {
      helpModal.hidden = true
      if (!game.dead && !game.won) endModal.hidden = true
    }
    return
  }
  if (!inventoryModal.hidden) {
    if (event.key === 'Escape' || event.key === 'i') inventoryModal.hidden = true
    return
  }
  const key = event.key.toLowerCase()
  const moves = {
    arrowup: [0, -1], w: [0, -1], k: [0, -1],
    arrowdown: [0, 1], s: [0, 1], j: [0, 1],
    arrowleft: [-1, 0], a: [-1, 0], h: [-1, 0],
    arrowright: [1, 0], d: [1, 0], l: [1, 0],
  }
  if (moves[key]) {
    event.preventDefault()
    tryAction('move', { dx: moves[key][0], dy: moves[key][1] })
  } else if (key === '.' || key === ' ') {
    event.preventDefault()
    tryAction('wait')
  } else if (key === 'g') {
    event.preventDefault()
    tryAction('pickup')
  } else if (key === 'i') {
    event.preventDefault()
    inventoryModal.hidden = false
    renderInventory()
  } else if (event.key === '>') {
    event.preventDefault()
    tryAction('descend')
  } else if (key === '?') {
    helpModal.hidden = false
  }
}

makeViewport()
bindUi()
game = loadInitialGame()
render()
