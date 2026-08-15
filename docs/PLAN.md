# 个人作品集 — SanZiNEO.github.io

## 定位

纯作品展示站，不放个人信息。展示数据分析、消费者洞察、商业研究、产品开发等方向的完整项目。

## 域名

`https://SanZiNEO.github.io/`

## 目录结构（方案 B）

```
SanZiNEO.github.io/
├── index.html                    # 首页 — 项目卡片网格
├── style.css                     # 全局样式
├── docs/
│   └── PLAN.md                   # 本文件
├── projects/
│   ├── coffee/
│   │   └── index.html            # 咖啡茶饮品牌社交媒体广告效果对比研究
│   ├── auto/
│   │   └── index.html            # 汽车品牌社交媒体用户画像与消费者洞察研究
│   ├── virtual-ip/
│   │   └── index.html            # 虚拟IP形象赋能品牌数字化传播效能测算与因果分析
│   ├── tourism/
│   │   └── index.html            # 短视频视域下鲁豫文旅品牌数字化传播效能研究
│   └── gaming/
│       └── index.html            # 游戏互动产品设计与开发
└── assets/
    └── images/                   # 图表截图、项目素材
        ├── coffee/
        ├── auto/
        ├── virtual-ip/
        ├── tourism/
        └── gaming/
```

## 首页

卡片网格布局，每个项目一张卡片：
- 项目标题
- 一句话概要
- 标签（数据采集 / NLP / 因果推断 / 产品开发）
- 鼠标悬停效果，点击进入详情

## 项目详情页

每个项目独立页面，包含：
- 项目标题 + 角色 + 时间
- 问题背景
- 方法流程（采集 → 分析 → 结论）
- 核心数据（数字高亮展示）
- 可视化图表（roughViz 手绘风格 / 截图）
- 关键发现
- 返回首页链接

## 技术方案

- 纯 HTML + CSS + JavaScript
- roughViz 手绘图表（来自 frontend-web skill）
- GitHub Pages 自动部署
- 不依赖构建工具，直接 push 即上线

## 待定事项

- [ ] 首页配色风格
- [ ] 每个项目的图表素材（截图还是 roughViz 生成）
- [ ] 文案编写（按 resume skill 的项目转简历方法）
- [ ] 后续：数据用 YAML 管理，build.py 生成 HTML（复用简历项目的思路）

## 进度

- [x] 创建仓库 SanZiNEO.github.io
- [x] 测试页面上线成功
- [ ] 项目详情页逐次编写
- [ ] 首页设计
