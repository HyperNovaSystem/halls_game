import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAP_H,
  MAP_W,
  VIEW_H,
  VIEW_W,
  action,
  cameraOrigin,
  createGame,
  restoreGame,
  serializeGame,
  tileAt,
  visibleCount,
} from '../src/game.js'

test('creates a deterministic 128x128 run from a seed', () => {
  const a = createGame({ seed: 12345 })
  const b = createGame({ seed: 12345 })

  assert.equal(a.map.length, MAP_W * MAP_H)
  assert.deepEqual(a.map, b.map)
  assert.deepEqual(a.rooms, b.rooms)
  assert.deepEqual(a.stairs, b.stairs)
  assert.deepEqual(a.monsters.slice(0, 8), b.monsters.slice(0, 8))
  assert.equal(a.items.length, b.items.length)
})

test('renders a bounded viewport over a much larger dungeon', () => {
  const game = createGame({ seed: 7 })
  const camera = cameraOrigin(game)

  assert.equal(VIEW_W * VIEW_H, 1536)
  assert.ok(camera.x >= 0 && camera.y >= 0)
  assert.ok(camera.x <= MAP_W - VIEW_W)
  assert.ok(camera.y <= MAP_H - VIEW_H)
})

test('field of view touches a sparse subset of the level', () => {
  const game = createGame({ seed: 99 })
  const count = visibleCount(game)

  assert.ok(count > 20)
  assert.ok(count < 230)
  assert.ok(count < MAP_W * MAP_H)
})

test('simulation is turn-based and does not mutate until an action succeeds', () => {
  const game = createGame({ seed: 321 })
  const before = serializeGame(game)
  assert.equal(game.turn, 0)

  // Walking into a wall is not a turn.
  action(game, 'move', { dx: -999, dy: 0 })
  assert.equal(game.turn, 0)
  assert.notEqual(serializeGame(game), before) // message log may change

  action(game, 'wait')
  assert.equal(game.turn, 1)
})

test('snapshot and restore preserve run state and RNG continuation', () => {
  const game = createGame({ seed: 2026 })
  action(game, 'wait')
  action(game, 'wait')
  const restored = restoreGame(serializeGame(game))

  assert.equal(restored.turn, game.turn)
  assert.deepEqual(restored.player, game.player)
  assert.deepEqual(restored.ident, game.ident)
  assert.deepEqual(restored.map, game.map)

  action(game, 'wait')
  action(restored, 'wait')
  assert.deepEqual(restored.monsters, game.monsters)
  assert.deepEqual(restored.items, game.items)
})

test('stairs exist on floor tiles', () => {
  const game = createGame({ seed: 42 })
  assert.equal(tileAt(game, game.stairs.x, game.stairs.y), 1)
})
