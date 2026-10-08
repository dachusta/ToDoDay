export interface Slot {
  index: number
  startMin: number
  label: string          // сырое HH:mm; 12ч рисует UI (FR-SET-3)
  isHour: boolean        // минуты подписи === 0
  isHalfHour: boolean    // минуты подписи === 30
}

export interface Conflict {
  placementIds: [string, string]
  overlapStart: number
  overlapEnd: number
}

/**
 * Высота одного слота (15 мин) в сетке дня, px (FR-B-1). Одна константа на всю
 * доску: по ней виртуализируется колонка подписей и позиционируется слой
 * размещений (`top = startMin / 15 * SLOT_HEIGHT`), поэтому карточка на
 * несколько слотов не «плывёт» относительно своей строки (ТЗ §5.3, НФТ §7).
 */
export const SLOT_HEIGHT = 24
