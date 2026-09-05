# dsh-message-outline

DSH web 前端插件：**当前会话消息大纲（左缘横杠）**——你发的消息在对话区左缘显示成一列细横杠，hover 展开完整大纲（行号+文本），点击瞬间定位到对话里那条消息。

纯前端实现：**零外部服务依赖**（不需要 3081/终端服务），sessions 快照订阅驱动、零轮询。

## 功能

- 左缘一列细横杠 = 我的消息（最近 10 条，最新在下），收起态无滚动条
- hover 同一元素展开完整大纲（横杠+行号+文本同一行，展开/收起位置严格对齐）
- 点击行 → 横杠+文字变蓝并瞬间定位到对话中该消息（黄色闪烁 1.6s）
- 收起态蓝条 = 当前视口所在消息（对话滚动时跟随，事件驱动节流）
- 深色/浅色主题跟随 dsh web（`--dsw-alias-*` 变量）

## 安装

```bash
# 在 dsh 安装好之后（npm i -g @deepseek-ai/dsh）
dsh plugin --profile web add dsh-message-outline
sudo systemctl restart dsh-web   # 或重启 dsh web 进程
```

刷新浏览器页面即生效（左缘出现消息横杠）。

## 说明

- 数据源：当前会话的 sessions 快照（`chat.order`/`chat.nodes` + 官方 `data-chat-anchor-key` 锚点定位），全部历史可跳转（`loadOlder` 懒加载）
- 从 dsh-term-panels 拆出独立发布（大纲功能，不含终端面板/Token HUD——那些需要 3081 服务，见 dsh-term-panels）

## 特别说明
- dsh增加了大纲功能，本插件不再更新。如有需要可以让你的ai分析插件自己适配新版dsh。

## License

MIT
