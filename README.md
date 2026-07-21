# OrganicChem Builder

有机化学分子构建器

## 功能

- 2D 键线式编辑器（绘制原子、化学键、官能团）
- 3D 球棍模型 / 空间填充模型
- 合成路径推断（需启动 Python 后端 `synthesis_api.py`）
- 缩略图渲染（RDKit.js）

## 使用

浏览器打开 `index.html`。合成推断功能需要 Python + RDKit：

```bash
pip install rdkit-pypi
python synthesis_api.py
```

## 技术栈

- **Three.js** — 3D 渲染 (MIT License)
- **RDKit.js** — 化学结构渲染 (BSD-3-Clause)
- **Python / RDKit** — 后端合成路径推断

## 许可证

本项目基于 MIT License 开源。依赖库的许可证：

- Three.js: MIT License — https://github.com/mrdoob/three.js
- RDKit: BSD-3-Clause — https://github.com/rdkit/rdkit
- RDKit.js: BSD-3-Clause — https://github.com/rdkit/rdkit-js
