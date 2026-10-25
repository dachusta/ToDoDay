import { onUnmounted, ref, type Ref } from 'vue'
import type { Placement } from 'src/models/dayInstance'
import type { Slot } from 'src/models/cycle'

interface GridHandle {
  slotAtY: (clientY: number) => number | null
}

/**
 * Pointer-drag карточки по сетке дня. Общий для доски «Сегодня» и редактора
 * плана: порог нажатия уже отработал в PlacementCard, здесь — слушатели окна,
 * слот под указателем и вызов переноса.
 */
export function usePlacementDrag(options: {
  gridRef: Readonly<Ref<GridHandle | null>>
  readOnly: () => boolean
  slots: () => Slot[]
  hoveredSlot: () => number | null
  onHover: (index: number | null) => void
  onDrop: (placementId: string, slot: Slot) => void | Promise<void>
  onEnd?: () => void
}) {
  const draggingId = ref<string | null>(null)

  function onDragMove(event: PointerEvent) {
    const index = options.gridRef.value?.slotAtY(event.clientY) ?? null
    options.onHover(index)
  }

  async function onDragDrop() {
    const placementId = draggingId.value
    const slotIndex = options.hoveredSlot()
    endDrag()
    if (placementId === null || slotIndex === null) return
    const slot = options.slots()[slotIndex]
    if (slot === undefined) return
    await options.onDrop(placementId, slot)
  }

  function startDrag(placement: Placement, event: PointerEvent) {
    if (options.readOnly()) return
    draggingId.value = placement.id
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragDrop)
    window.addEventListener('pointercancel', endDrag)
    onDragMove(event)
  }

  function endDrag() {
    draggingId.value = null
    options.onHover(null)
    options.onEnd?.()
    window.removeEventListener('pointermove', onDragMove)
    window.removeEventListener('pointerup', onDragDrop)
    window.removeEventListener('pointercancel', endDrag)
  }

  onUnmounted(endDrag)

  return { draggingId, startDrag, endDrag }
}
