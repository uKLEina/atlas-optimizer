/**
 * PoE Planner エクスポートURLの生成/読み取り(pyref/atlasopt/export.py の移植)。
 *
 * 形式は poeplanner.com のバンドル解析により特定し、実際にサイトで開けることを
 * 確認済み(詳細は DESIGN.md)。全てリトルエンディアン:
 *
 *   u16 serializationVersion = 5
 *   u16 treeVersion            (28 = PoE 3.29.0)
 *   u8  isPoE2 = 0
 *   u16 選択ノード数
 *   ノード数 × u16 ノードID    (GGGのskill id = data.jsonのキー)
 *   u16 gzip長 + gzip(メモ文字列)
 *
 * URL は base64 の '+'→'-', '/'→'_' 置換('=' パディングは残す)。
 * gzip は pyref とバイト一致しない(fflate と CPython でヘッダの XFL/OS が違う)が、
 * PoE Planner が要求するのは有効な gzip ストリームであることのみ。
 * treeVersion はリーグ更新で変わる: https://cdn.poeplanner.com/json/versions.json
 */

import { gzipSync, gunzipSync } from "fflate";

export const TREE_VERSION_3_29 = 28;
const SERIALIZATION_VERSION = 5;
const BASE_URL = "https://poeplanner.com/atlas-tree/";

export interface DecodedUrl {
  serializationVersion: number;
  treeVersion: number;
  isPoe2: boolean;
  nodeIds: number[];
  notes: string;
}

export function encodeUrl(
  nodeIds: Iterable<string | number>,
  treeVersion: number = TREE_VERSION_3_29,
  notes = "",
): string {
  const ids = [...nodeIds]
    .map((n) => (typeof n === "number" ? n : Number.parseInt(n, 10)))
    .sort((a, b) => a - b);
  for (const id of ids) {
    // Python 版は struct.error で落ちる。DataView は黙って切り捨てるため明示チェック
    if (!Number.isInteger(id) || id < 0 || id > 0xffff) {
      throw new Error(`node id out of u16 range: ${id}`);
    }
  }
  const blob = gzipSync(new TextEncoder().encode(notes), { mtime: 0, level: 9 });
  const buf = new Uint8Array(7 + 2 * ids.length + 2 + blob.length);
  const view = new DataView(buf.buffer);
  view.setUint16(0, SERIALIZATION_VERSION, true);
  view.setUint16(2, treeVersion, true);
  view.setUint8(4, 0); // isPoE2 = false
  view.setUint16(5, ids.length, true);
  ids.forEach((id, i) => view.setUint16(7 + 2 * i, id, true));
  view.setUint16(7 + 2 * ids.length, blob.length, true);
  buf.set(blob, 9 + 2 * ids.length);
  const code = bytesToBase64(buf).replace(/\+/g, "-").replace(/\//g, "_");
  return BASE_URL + code;
}

export function decodeUrl(url: string): DecodedUrl {
  const trimmed = url.replace(/\/+$/, "");
  const code = trimmed
    .slice(trimmed.lastIndexOf("/") + 1)
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const b = base64ToBytes(code);
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const serializationVersion = view.getUint16(0, true);
  const treeVersion = view.getUint16(2, true);
  const isPoe2 = view.getUint8(4) !== 0;
  const count = view.getUint16(5, true);
  const nodeIds = Array.from({ length: count }, (_, i) => view.getUint16(7 + 2 * i, true));
  const off = 7 + 2 * count;
  const blobLen = view.getUint16(off, true);
  const notes = new TextDecoder("utf-8", { fatal: true }).decode(
    gunzipSync(b.subarray(off + 2, off + 2 + blobLen)),
  );
  return { serializationVersion, treeVersion, isPoe2, nodeIds, notes };
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function base64ToBytes(code: string): Uint8Array {
  const bin = atob(code);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
