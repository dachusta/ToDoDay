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
