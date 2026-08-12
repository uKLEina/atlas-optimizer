/** hover 時の DOM ツールチップ(name + stats + reminderText)。 */

import type { AtlasNode } from "../data/graph";

export class Tooltip {
  constructor(private readonly el: HTMLElement) {}

  show(nd: AtlasNode, clientX: number, clientY: number): void {
    this.el.replaceChildren();
    if (nd.name) {
      const h = document.createElement("div");
      h.className = "tt-name";
      h.textContent = nd.name;
      this.el.appendChild(h);
    }
    for (const line of nd.stats ?? []) {
      const div = document.createElement("div");
      div.className = "tt-stat";
      div.textContent = line;
      this.el.appendChild(div);
    }
    for (const line of nd.reminderText ?? []) {
      const div = document.createElement("div");
      div.className = "tt-reminder";
      div.textContent = line;
      this.el.appendChild(div);
    }
    this.el.hidden = false;
    // 画面右端・下端からはみ出さない位置に置く
    const margin = 14;
    const rect = this.el.getBoundingClientRect();
    let x = clientX + margin;
    let y = clientY + margin;
    if (x + rect.width > window.innerWidth) x = clientX - rect.width - margin;
    if (y + rect.height > window.innerHeight) y = clientY - rect.height - margin;
    this.el.style.left = `${x}px`;
    this.el.style.top = `${y}px`;
  }

  hide(): void {
    this.el.hidden = true;
  }
}
