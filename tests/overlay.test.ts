// tests/overlay.test.ts
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { drawTexts } from '../src/render/overlay.ts'
import type { TextItem } from '../src/project/types.ts'

interface Call {
  op: 'fill' | 'stroke'
  text: string
  x: number
  y: number
  font: string
  color: string
}

function recorder() {
  const calls: Call[] = []
  const ctx = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    textAlign: '',
    textBaseline: '',
    save() {},
    restore() {},
    fillText(text: string, x: number, y: number) {
      calls.push({ op: 'fill', text, x, y, font: this.font, color: String(this.fillStyle) })
    },
    strokeText(text: string, x: number, y: number) {
      calls.push({ op: 'stroke', text, x, y, font: this.font, color: String(this.strokeStyle) })
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

const item = (patch: Partial<TextItem>): TextItem => ({
  id: 't',
  text: 'Hello',
  start: 0,
  end: 1,
  x: 0.5,
  y: 0.8,
  size: 0.1,
  color: '#ff0000',
  ...patch,
})

describe('drawTexts', () => {
  it('draws nothing for an empty list', () => {
    const { ctx, calls } = recorder()
    drawTexts(ctx, 1000, 500, [])
    assert.equal(calls.length, 0)
  })

  it('places the caption by fractions of the frame and scales the font by height', () => {
    const { ctx, calls } = recorder()
    drawTexts(ctx, 1000, 500, [item({})])
    const fill = calls.find((c) => c.op === 'fill')
    assert.ok(fill)
    assert.equal(fill.x, 500)
    assert.equal(fill.y, 400)
    assert.equal(fill.color, '#ff0000')
    assert.match(fill.font, /\b50px\b/)
    assert.ok(calls.some((c) => c.op === 'stroke'))
  })

  it('gives the same relative result at another resolution', () => {
    const small = recorder()
    const big = recorder()
    drawTexts(small.ctx, 640, 360, [item({})])
    drawTexts(big.ctx, 1920, 1080, [item({})])
    const a = small.calls.find((c) => c.op === 'fill')
    const b = big.calls.find((c) => c.op === 'fill')
    assert.ok(a && b)
    assert.equal(b.x / a.x, 3)
    assert.equal(b.y / a.y, 3)
  })

  it('stacks several lines around the anchor', () => {
    const { ctx, calls } = recorder()
    drawTexts(ctx, 1000, 500, [item({ text: 'one\ntwo', y: 0.5 })])
    const fills = calls.filter((c) => c.op === 'fill')
    assert.deepEqual(fills.map((c) => c.text), ['one', 'two'])
    assert.ok(fills[0].y < 250 && fills[1].y > 250)
    assert.equal((fills[0].y + fills[1].y) / 2, 250)
  })
})
