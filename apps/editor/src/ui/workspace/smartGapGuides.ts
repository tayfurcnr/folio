type Rect = readonly [number, number, number, number]

export type SmartGapGuide =
  | { readonly axis: 'horizontal'; readonly x1: number; readonly x2: number; readonly y: number; readonly label: string; readonly id: string }
  | { readonly axis: 'vertical'; readonly y1: number; readonly y2: number; readonly x: number; readonly label: string; readonly id: string }

export interface GapShape {
  readonly id: string
  readonly rect: Rect | null
  readonly rotation?: number | null
  readonly hidden?: boolean
}

function axisAlignedRect(rect: Rect, rotation = 0): Rect {
  const radians = rotation * Math.PI / 180
  const width = Math.abs(rect[2] * Math.cos(radians)) + Math.abs(rect[3] * Math.sin(radians))
  const height = Math.abs(rect[2] * Math.sin(radians)) + Math.abs(rect[3] * Math.cos(radians))
  return [rect[0] + rect[2] / 2 - width / 2, rect[1] + rect[3] / 2 - height / 2, width, height]
}

function overlap(startA: number, sizeA: number, startB: number, sizeB: number): number {
  return Math.min(startA + sizeA, startB + sizeB) - Math.max(startA, startB)
}

function union(rects: readonly Rect[]): Rect | null {
  if (!rects.length) return null
  const left = Math.min(...rects.map((rect) => rect[0]))
  const top = Math.min(...rects.map((rect) => rect[1]))
  const right = Math.max(...rects.map((rect) => rect[0] + rect[2]))
  const bottom = Math.max(...rects.map((rect) => rect[1] + rect[3]))
  return [left, top, right - left, bottom - top]
}

/** Find equal clearances on either side of the moving selection. */
export function findSmartGapGuides(
  selected: readonly GapShape[],
  fixed: readonly GapShape[],
  tolerance = 4,
): SmartGapGuide[] {
  const moving = union(selected.flatMap((shape) => shape.rect ? [axisAlignedRect(shape.rect, shape.rotation ?? 0)] : []))
  if (!moving) return []
  const obstacles = fixed
    .filter((shape) => !shape.hidden && !selected.some((item) => item.id === shape.id) && shape.rect)
    .map((shape) => ({ id: shape.id, rect: axisAlignedRect(shape.rect!, shape.rotation ?? 0) }))
  const guides: SmartGapGuide[] = []

  const left = obstacles
    .filter(({ rect }) => rect[0] + rect[2] <= moving[0] && overlap(rect[1], rect[3], moving[1], moving[3]) > 0)
    .sort((a, b) => (b.rect[0] + b.rect[2]) - (a.rect[0] + a.rect[2]))[0]
  const right = obstacles
    .filter(({ rect }) => rect[0] >= moving[0] + moving[2] && overlap(rect[1], rect[3], moving[1], moving[3]) > 0)
    .sort((a, b) => a.rect[0] - b.rect[0])[0]
  if (left && right) {
    const leftGap = moving[0] - left.rect[0] - left.rect[2]
    const rightGap = right.rect[0] - moving[0] - moving[2]
    if (leftGap > 0 && rightGap > 0 && Math.abs(leftGap - rightGap) <= tolerance) {
      const y = moving[1] + moving[3] / 2
      const label = String(Math.round((leftGap + rightGap) / 2))
      guides.push({ axis: 'horizontal', x1: left.rect[0] + left.rect[2], x2: moving[0], y, label, id: `h-left-${left.id}` })
      guides.push({ axis: 'horizontal', x1: moving[0] + moving[2], x2: right.rect[0], y, label, id: `h-right-${right.id}` })
    }
  }

  const above = obstacles
    .filter(({ rect }) => rect[1] + rect[3] <= moving[1] && overlap(rect[0], rect[2], moving[0], moving[2]) > 0)
    .sort((a, b) => (b.rect[1] + b.rect[3]) - (a.rect[1] + a.rect[3]))[0]
  const below = obstacles
    .filter(({ rect }) => rect[1] >= moving[1] + moving[3] && overlap(rect[0], rect[2], moving[0], moving[2]) > 0)
    .sort((a, b) => a.rect[1] - b.rect[1])[0]
  if (above && below) {
    const topGap = moving[1] - above.rect[1] - above.rect[3]
    const bottomGap = below.rect[1] - moving[1] - moving[3]
    if (topGap > 0 && bottomGap > 0 && Math.abs(topGap - bottomGap) <= tolerance) {
      const x = moving[0] + moving[2] / 2
      const label = String(Math.round((topGap + bottomGap) / 2))
      guides.push({ axis: 'vertical', y1: above.rect[1] + above.rect[3], y2: moving[1], x, label, id: `v-above-${above.id}` })
      guides.push({ axis: 'vertical', y1: moving[1] + moving[3], y2: below.rect[1], x, label, id: `v-below-${below.id}` })
    }
  }
  return guides
}
