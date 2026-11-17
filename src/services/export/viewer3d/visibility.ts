export interface VisibleNode {
  visible: boolean;
  parent?: VisibleNode | null;
}

/** Đối tượng chỉ "thật sự hiển thị" khi bản thân và mọi nhóm cha đều visible. */
export function isEffectivelyVisible(obj: VisibleNode | null | undefined): boolean {
  for (let o = obj; o; o = o.parent) {
    if (!o.visible) return false;
  }
  return true;
}

/** Lấy giao điểm gần nhất của đối tượng đang hiển thị (raycaster không tự bỏ qua visible=false). */
export function firstVisibleHit<T extends { object: VisibleNode }>(hits: T[]): T | null {
  for (const h of hits) if (isEffectivelyVisible(h.object)) return h;
  return null;
}
