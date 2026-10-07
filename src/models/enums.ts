export type Priority = 'low' | 'medium' | 'high' | 'critical'
export type PlacementStatus = 'pending' | 'done' | 'skipped'
export type InstanceStatus = 'active' | 'completed'
export type RepeatRuleType = 'none' | 'weekdays' | 'monthdays'
export type ThemeMode = 'light' | 'dark' | 'auto'
export type TimeFormat = '24h' | '12h'
// Режим сдвига дня (ТЗ §2.8)
export type ShiftMode = 'early' | 'midnight' | 'overdue'
