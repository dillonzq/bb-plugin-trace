# Trace logo concepts

预览：[trace-logo-concepts.svg](trace-logo-concepts.svg)

| 方案 | 文件 | 方向 |
| --- | --- | --- |
| 01 | [Signal Trail](trace-01-signal-trail.svg) | 事件流轨迹 |
| 02 | [Trace Lens](trace-02-trace-lens.svg) | 检索与定位 |
| 03 | [JSON Pulse](trace-03-json-pulse.svg) | JSONL 与事件脉冲 |
| 04 | [Timeline Lanes](trace-04-timeline-lanes.svg) | Input / Model / Tools 三泳道 |
| 05 | [Converging Events](trace-05-converging-events.svg) | 多路事件汇聚 |
| 06 | [Orbit Loop](trace-06-orbit-loop.svg) | 历史、循环与上下文 |

全部为独立 SVG，256 × 256，适合继续导出 PNG 或接入插件 branding。

## BB UI 纯色图标

预览：[trace-ui-icon-sheet.svg](ui-icons/trace-ui-icon-sheet.svg)

这组按截图中的 BB UI 风格制作：24 × 24、单色 `currentColor`、细描边、圆角端点，无渐变和多色填充。

- [01 Event path](ui-icons/trace-ui-01-path.svg)
- [02 Inspect lens](ui-icons/trace-ui-02-lens.svg)
- [03 JSON pulse](ui-icons/trace-ui-03-json.svg)
- [04 Timeline lanes](ui-icons/trace-ui-04-lanes.svg)
- [05 Converge](ui-icons/trace-ui-05-converge.svg)
- [06 Orbit loop](ui-icons/trace-ui-06-orbit.svg)

### 第二轮：更接近 BB 侧栏的极简变体

预览：[trace-ui-icon-sheet-v2.svg](ui-icons/trace-ui-icon-sheet-v2.svg)

- [07 Thread spine](ui-icons/trace-ui-v2-01-spine.svg)
- [08 Focus path](ui-icons/trace-ui-v2-02-focus-path.svg)
- [09 Fork & merge](ui-icons/trace-ui-v2-03-fork-merge.svg)
- [10 Log stack](ui-icons/trace-ui-v2-04-log-stack.svg)
- [11 Replay](ui-icons/trace-ui-v2-05-replay.svg)
- [12 Wave frame](ui-icons/trace-ui-v2-06-wave-frame.svg)

## branding.icon 注意事项

`ui-icons/` 下的 SVG 适合内联 BB UI，使用 `currentColor`。不要默认把它们当作 `branding.icon` 的颜色来源：已安装 SDK 对部分宿主/Provider 图标明确记录为通过 `<img>` 加载，此时 `currentColor` 不会继承主题色。

已将插件 compact branding 切换为显式颜色的 Waypoints 版本：[trace-branding-waypoints.svg](trace-branding-waypoints.svg)：

```json
"branding": {
  "icon": "./logos/trace-branding-waypoints.svg"
}
```

当前 BB 源码的插件 compact icon 另有 CSS mask 路径，但不同宿主表面不要混用这两种假设；最终以运行中的 BB 0.43.1 实测为准。

## Hugeicons 候选

预览：[hugeicons-trace-candidates.svg](hugeicons-trace-candidates.svg)

以下图标已在 `@hugeicons/core-free-icons` 4.3.2 中确认存在：

| 推荐 | Hugeicons 名称 | 适合 Trace 的含义 |
| --- | --- | --- |
| ★ | `WaypointsIcon` | 轨迹节点，最推荐 |
|  | `TimelineListIcon` | 按时间排列的事件 |
|  | `FlowConnectionIcon` | 工具调用链路 |
|  | `Activity01Icon` | 活动与事件变化 |
|  | `LogsIcon` | 原始 JSONL 记录 |
|  | `InspectCodeIcon` | 搜索和检查 payload |

BB 原生注册名中已有 `Workflow`、`Code`、`ChartColumn`、`Target` 等对应图标；若要使用上述未注册图标，需要在插件 UI 中安装 Hugeicons 并自行渲染，或导出为 SVG 后配置 `branding.icon`。
