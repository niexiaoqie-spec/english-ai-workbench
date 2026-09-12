# English AI Workbench - AI英语学习工作台

一个基于 Kimi AI 的个人英语学习 PWA 应用，支持阅读分析、智能复习(SRS)、精听训练和AI口语对练。

## 功能模块

- **阅读 + 生词本**：粘贴英文文章，AI 自动提取生词、生成释义和例句，一键加入生词本
- **SRS 智能复习**：基于 FSRS 算法的间隔重复，支持单词/短语/语法多维复习卡片
- **精听训练**：导入英文材料，AI 生成理解题，支持浏览器语音朗读和变速播放
- **AI 口语对练**：8种情境场景（面试、旅行、商务等），AI实时对话、纠错、打分

## 快速开始

### 前提条件
- Python 3.10+
- Kimi API Key（从 https://platform.moonshot.cn 获取）

### 方式一：Windows 一键启动
```
cd server
start.bat
```
或带 API Key 启动：
```
start.bat sk-your-kimi-api-key
```

### 方式二：手动启动
```bash
cd server
pip install -r requirements.txt
# 可选：设置环境变量
set KIMI_API_KEY=sk-your-key
python main.py
```

### 访问方式
- 电脑浏览器：http://localhost:8000
- 手机（同一WiFi）：http://电脑IP:8000
  - 查看电脑IP：Windows 运行 `ipconfig`，找 IPv4 地址
- 添加到主屏幕：手机浏览器打开后，选择"添加到主屏幕"，即可像APP一样使用

### 设置 API Key
启动后打开应用 → 底部导航"我的" → 输入 Kimi API Key → 保存

## 部署到云端（可选）

如果希望随时随地访问（不限同一WiFi），可以部署到云端：

### Railway 部署
1. 将项目推送到 GitHub
2. 访问 https://railway.app ，用 GitHub 登录
3. New Project → Deploy from GitHub repo
4. 设置 Build Command: `cd server && pip install -r requirements.txt`
5. 设置 Start Command: `cd server && python main.py`
6. 设置环境变量 `KIMI_API_KEY`
7. 部署完成后获得公网 URL，手机直接访问

### Render 部署
1. 访问 https://render.com
2. New → Web Service → 连接 GitHub 仓库
3. Root Directory: `server`
4. Build Command: `pip install -r requirements.txt`
5. Start Command: `python main.py`
6. 添加环境变量 `KIMI_API_KEY`

## 技术栈

- 后端：Python FastAPI + SQLite + OpenAI SDK (Kimi API)
- 前端：原生 ES Modules + CSS（无框架，零构建）
- PWA：Service Worker + Web App Manifest
- 语音：Web Speech API（浏览器内置 TTS + 语音识别）
- 算法：FSRS 间隔重复调度

## 项目结构

```
english-ai-workbench/
├── server/
│   ├── main.py              # FastAPI 入口
│   ├── database.py          # SQLite 数据库
│   ├── kimi.py              # Kimi API 客户端
│   ├── fsrs.py              # FSRS 复习算法
│   ├── requirements.txt     # Python 依赖
│   ├── start.bat            # Windows 启动脚本
│   └── routers/
│       ├── reading.py       # 阅读分析 API
│       ├── srs.py           # SRS 复习 API
│       ├── listening.py     # 听力练习 API
│       ├── speaking.py      # 口语对练 API
│       ├── vocabulary.py    # 生词本 API
│       └── settings.py      # 设置 API
└── static/
    ├── index.html           # PWA 入口
    ├── manifest.json        # PWA 配置
    ├── sw.js                # Service Worker
    ├── css/style.css        # 样式
    ├── js/                  # 前端模块
    │   ├── app.js           # 核心路由和工具
    │   ├── reading.js       # 阅读页面
    │   ├── srs.js           # 复习页面
    │   ├── listening.js     # 听力页面
    │   ├── speaking.js      # 口语页面
    │   └── profile.js       # 个人中心
    └── icons/               # 应用图标
```
