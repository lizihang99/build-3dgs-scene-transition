# Build 3DGS Scene Transition

一个可复用的 Codex Skill 和独立演示模板，用于在两套互不相关的 3D Gaussian Splatting 场景之间制作原生 GSplat 转场。

效果流程：

1. 旧 3DGS 场景沿方向场消散。
2. 画面停留在持续流动的高斯光尘中段，可响应音乐 FFT。
3. 用户第二次操作后，新 3DGS 场景从分散状态重新聚合。

中段粒子同样使用 Gaussian splats，而不是普通 `THREE.Points`。默认效果不依赖两套资产之间的一一粒子对应，也不使用白闪或过曝遮挡切换。

## 包含内容

- 可直接运行的 Spark 2.1.x + Three.js 演示
- Release、Hold、Gather 三阶段转场
- 两按钮交互状态机
- Curl-like flow、spectral filaments 和纵深脉冲运动
- 音频 FFT 响应与暂停衰减
- 两份带授权的 `.spz` 示例资产和一首 CC BY 4.0 示例音乐
- 新场景脚手架生成器
- Playwright 浏览器契约测试和画面内容检测

## 运行演示

要求 Node.js 22 和 npm。

```bash
cd assets/transition-template
npm ci
npm run dev
```

打开：

```text
https://localhost:5187/transition-dust-demo.html
```

开发服务器使用本地自签名 HTTPS 证书，浏览器首次访问时需要允许继续访问。

## 安装为 Codex Skill

仓库根目录本身就是 Skill。登录 GitHub CLI 后可安装到个人 Skill 目录：

```bash
gh repo clone lizihang99/build-3dgs-scene-transition \
  "${CODEX_HOME:-$HOME/.codex}/skills/build-3dgs-scene-transition"
```

之后可以向 Codex 提出类似请求：

```text
使用 build-3dgs-scene-transition，把 old-scene.spz 和 new-scene.splat
做成带 FFT 响应的双按钮 3DGS 转场。
```

## 替换为自己的 3DGS 资产

使用脚手架生成独立项目：

```bash
python3 scripts/scaffold_transition.py \
  --output /absolute/path/to/new-demo \
  --outgoing /absolute/path/to/old-scene.spz \
  --incoming /absolute/path/to/new-scene.splat
```

然后：

```bash
cd /absolute/path/to/new-demo
npm ci
npm run build
npm test
```

在 `src/demo/transitionConfig.ts` 中分别校准：

- `position`：场景位置
- `rotationDeg`：源资产方向修正
- `scale`：场景归一化缩放
- `accent`：消散和聚合阶段的代表色
- `wind`：粒子离场或回流方向

`.splat`、`.spz`、`.ply` 等格式能否使用，取决于当前 Spark 版本的加载器支持。

## 实现结构

```text
旧场景 Splat 数据
       |
       v
Release modifier -> Hold proxy GSplats -> Gather modifier
                                              |
                                              v
                                      新场景 Splat 数据
```

两份场景会预加载到独立的 `PackedSplats`，但场景树中只保留一个稳定的 `SplatMesh`。进入 Gather 前，同步切换它的 `splats`、`packedSplats`、场景变换和 modifier，再更新 generator 与 mapping。这样可以避免 Spark 2.1.x 中多个动态场景 generator 发生 accumulator 数据串线。

主要模块：

- `SplatTransitionPair`：场景预加载、单 mesh 切源、Release/Gather modifier
- `TransitionDustField`：中段代理 GSplat、流场、光丝、边缘气氛和 FFT uniforms
- `AudioEngine`：音频播放、频段分析和响应衰减
- `window.__transitionDustDemo`：自动化验证与调试接口

## 验证

```bash
python3 scripts/verify_template.py

cd assets/transition-template
npm run build
npm test
```

浏览器测试会检查：

- 初始和最终 3DGS 均真实渲染，而不是只有纯色背景
- Release 后停留在持续运动的 Hold 状态
- 第二次操作先产生纵深推进，再显示新场景
- 最终只显示新场景，代理粒子透明度归零
- 桌面和移动端控制没有越界
- 浏览器控制台没有错误

## 授权

项目代码使用 [MIT License](LICENSE)。

- 示例 3DGS：MIT-0，详情见 `assets/transition-template/public/scenes/SCENE-ASSETS-LICENSE.txt`
- 示例音乐 `Cipher`：CC BY 4.0，详情见 `assets/transition-template/public/audio/Cipher-LICENSE.txt`

替换为自己的 3DGS 或音频素材时，需要自行确认并保留相应授权。
