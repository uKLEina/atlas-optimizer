"""data.json からのグラフ構築。

- mastery ノード(グループ中央の飾り、辺なし)は除外する
- データ上の擬似ノード "root" は捨て、スタートノード 29045 を root として扱う
- root のコストは 0、他は全ノード 1(Atlas Tree の仕様)
- 辺は in/out を統合して無向として扱う
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

ROOT_ID = "29045"  # スタートノード(名前空)。ポイントを消費しない

_PSEUDO_ROOT = "root"

_REPO_ROOT = Path(__file__).resolve().parents[2]
# 標準は submodule(vendor/atlastree-export)。ルート直下のベタ置きはフォールバック
_DATA_CANDIDATES = (
    _REPO_ROOT / "vendor" / "atlastree-export" / "data.json",
    _REPO_ROOT / "data.json",
)


def _default_data() -> Path:
    for p in _DATA_CANDIDATES:
        if p.is_file():
            return p
    raise FileNotFoundError(
        "data.json not found — run `git submodule update --init` "
        f"(searched: {', '.join(map(str, _DATA_CANDIDATES))})"
    )


@dataclass(frozen=True)
class AtlasGraph:
    adj: dict[str, frozenset[str]]
    info: dict[str, dict]  # 生のノード情報(mastery・擬似rootを除く)
    mastery_notables: dict[str, tuple[str, ...]]  # masteryノードid -> 同グループのNotable id
    root: str = ROOT_ID

    def cost(self, node: str) -> int:
        return 0 if node == self.root else 1

    @property
    def nodes(self) -> frozenset[str]:
        return frozenset(self.adj)


def load(path: str | Path | None = None) -> AtlasGraph:
    data_path = Path(path) if path else _default_data()
    raw = json.loads(data_path.read_text())
    nodes = raw["nodes"]

    def is_graph_node(nid: str) -> bool:
        return nid != _PSEUDO_ROOT and not nodes[nid].get("isMastery")

    adj: dict[str, set[str]] = {n: set() for n in nodes if is_graph_node(n)}
    for nid, nd in nodes.items():
        if not is_graph_node(nid):
            continue
        for other in list(nd.get("out", [])) + list(nd.get("in", [])):
            if other != nid and other in adj:
                adj[nid].add(other)
                adj[other].add(nid)

    if ROOT_ID not in adj:
        raise ValueError(f"start node {ROOT_ID} not found in {data_path}")

    notables_by_group: dict[int, list[str]] = {}
    for nid, nd in nodes.items():
        if nid != _PSEUDO_ROOT and nd.get("isNotable"):
            notables_by_group.setdefault(nd["group"], []).append(nid)
    mastery_notables = {
        nid: tuple(notables_by_group.get(nd["group"], ()))
        for nid, nd in nodes.items()
        if nid != _PSEUDO_ROOT and nd.get("isMastery")
    }

    info = {nid: nodes[nid] for nid in adj}
    return AtlasGraph(
        adj={n: frozenset(s) for n, s in adj.items()},
        info=info,
        mastery_notables=mastery_notables,
    )


def reachable_from(adj: dict[str, frozenset[str]], start: str, banned: frozenset[str] = frozenset()) -> set[str]:
    """banned を通らずに start から到達できるノード集合(start含む)。"""
    if start in banned or start not in adj:
        return set()
    seen = {start}
    stack = [start]
    while stack:
        cur = stack.pop()
        for nxt in adj[cur]:
            if nxt not in seen and nxt not in banned:
                seen.add(nxt)
                stack.append(nxt)
    return seen
