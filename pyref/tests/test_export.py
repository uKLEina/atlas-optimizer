import random

from atlasopt.export import decode_url, encode_url

# セッション中にPoE Plannerで実際に開けることを確認したURL(スタート+隣接2ノード)
KNOWN_URL = "https://poeplanner.com/atlas-tree/BQAcAAADAHVxT_fEphQAH4sIAAAAAAAC_wMAAAAAAAAAAAA="


def test_roundtrip():
    rng = random.Random(0)
    ids = rng.sample(range(1, 65536), 140)
    url = encode_url(ids)
    d = decode_url(url)
    assert d["node_ids"] == sorted(ids)
    assert d["serialization_version"] == 5
    assert d["tree_version"] == 28
    assert d["is_poe2"] is False
    assert d["notes"] == ""


def test_known_url_decodes():
    # 実地検証済みURLが正しく読める(形式の理解が壊れたら即検知)
    d = decode_url(KNOWN_URL)
    assert d["serialization_version"] == 5
    assert d["tree_version"] == 28
    assert d["is_poe2"] is False
    assert sorted(d["node_ids"]) == [29045, 42692, 63311]
    assert d["notes"] == ""
    # 同じ集合を再エンコードしても意味的に同一(IDはソートされる)
    assert decode_url(encode_url(d["node_ids"]))["node_ids"] == sorted(d["node_ids"])


def test_notes_roundtrip():
    url = encode_url([29045], notes="hello Atlas")
    assert decode_url(url)["notes"] == "hello Atlas"
