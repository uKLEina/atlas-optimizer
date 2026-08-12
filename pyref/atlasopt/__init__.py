"""Atlas Tree point-allocation optimizer — Python reference implementation.

役割はプロダクション実装(TypeScript + highs-js)の照合オラクルであり、
速度より単純さと正しさを優先する。設計判断の経緯はリポジトリ直下の
DESIGN.md を参照。
"""

from .graph import AtlasGraph, ROOT_ID, load
from .result import SolveResult

__all__ = ["AtlasGraph", "ROOT_ID", "load", "SolveResult"]
