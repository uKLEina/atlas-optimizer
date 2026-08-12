"""PoE Planner エクスポートURLの生成/読み取り。

形式は poeplanner.com のバンドル解析により特定し、実際にサイトで開けることを
確認済み(詳細は DESIGN.md)。全てリトルエンディアン:

  u16 serializationVersion = 5
  u16 treeVersion            (28 = PoE 3.29.0)
  u8  isPoE2 = 0
  u16 選択ノード数
  ノード数 × u16 ノードID    (GGGのskill id = data.jsonのキー)
  u16 gzip長 + gzip(メモ文字列)

URL は base64 の '+'→'-', '/'→'_' 置換('=' パディングは残す)。
選択ノードにはスタートノード(29045)を含めてよい(PoE Planner側でポイント0扱い)。
treeVersion はリーグ更新で変わる: https://cdn.poeplanner.com/json/versions.json
"""

from __future__ import annotations

import base64
import gzip
import struct

TREE_VERSION_3_29 = 28
_SERIALIZATION_VERSION = 5
_BASE_URL = "https://poeplanner.com/atlas-tree/"


def encode_url(node_ids, tree_version: int = TREE_VERSION_3_29, notes: str = "") -> str:
    ids = sorted(int(n) for n in node_ids)
    buf = bytearray()
    buf += struct.pack("<HH", _SERIALIZATION_VERSION, tree_version)
    buf += b"\x00"  # isPoE2 = false
    buf += struct.pack("<H", len(ids))
    for nid in ids:
        buf += struct.pack("<H", nid)
    blob = gzip.compress(notes.encode(), mtime=0)  # mtime固定で出力を決定的に
    buf += struct.pack("<H", len(blob))
    buf += blob
    code = base64.b64encode(bytes(buf)).decode().replace("+", "-").replace("/", "_")
    return _BASE_URL + code


def decode_url(url: str) -> dict:
    code = url.rstrip("/").rsplit("/", 1)[-1].replace("-", "+").replace("_", "/")
    b = base64.b64decode(code)
    ver, tree_version = struct.unpack_from("<HH", b, 0)
    is_poe2 = b[4]
    (count,) = struct.unpack_from("<H", b, 5)
    ids = list(struct.unpack_from(f"<{count}H", b, 7))
    off = 7 + 2 * count
    (blob_len,) = struct.unpack_from("<H", b, off)
    notes = gzip.decompress(b[off + 2 : off + 2 + blob_len]).decode()
    return {
        "serialization_version": ver,
        "tree_version": tree_version,
        "is_poe2": bool(is_poe2),
        "node_ids": ids,
        "notes": notes,
    }
