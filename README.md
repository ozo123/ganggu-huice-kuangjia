# 港股回测框架

港股单因子研究、多因子训练、每日滚动持仓及统一可视化的 skill 流程包。

当前规范版本：`2026-09-29.train2010-2022-rolling20-talib-v6`。

## 核心口径

- 单因子回测与多因子训练仅使用 **2010-01-01 至 2022-12-31**；方向、IC、因子值相关性、去重及筛选同样受此边界约束。
- 训练信号、入场和收益标签到期日必须全部落在训练区间，清除跨年末的未成熟标签。
- **2023–2025 仅用于冻结后的组合测试**，不能进入拟合、选库、调参、方向选择或 early stopping。
- 默认 **20 个市场交易日持仓，每日滚动**：信号 t 收盘、t+1 开盘入场、t+21 收盘到期。已结算现金共享复用，停牌到期残仓独立管理。
- 因子相关性采用训练期月末原始因子值 Pearson，按有效日期等权平均；不是 IC 序列相关性。
- 统一可视化固定采用 **TA-Lib双因子库2010-2022-2026-0928-回测结果** 模板。包含完整单因子详情、渲染后的公式、经济含义推测、IC、分组、收益与指标。

具体约束、例外与验收标准以 [SKILL.md](skills/hk-factor-backtest/SKILL.md) 及其引用文档为准。

## 文件入口

- [最新完整流程包 ZIP](dist/hk-factor-backtest-20d-2010-2022-talib-v6.zip) 与 [SHA-256](dist/hk-factor-backtest-20d-2010-2022-talib-v6.zip.sha256)
- [Skill 主流程](skills/hk-factor-backtest/SKILL.md)
- [单因子口径](skills/hk-factor-backtest/references/standalone-methodology.md)
- [多因子训练与冻结测试](skills/hk-factor-backtest/references/multifactor-workflow.md)
- [20 日滚动账本与验收](skills/hk-factor-backtest/references/rolling-execution.md)
- [统一可视化规范](skills/hk-factor-backtest/references/standalone-report.md) 与 [原版模板快照](skills/hk-factor-backtest/assets/talib-20260928/template.json)
- [单因子配置示例](skills/hk-factor-backtest/assets/example_config.json) 与 [多因子流程配置示例](skills/hk-factor-backtest/assets/example_multifactor_config.json)
- [历史结果日期核对回执](skills/hk-factor-backtest/verification/existing-result-date-audit.json)
- [流程包清单及文件哈希](skills/hk-factor-backtest/package-manifest.json) 与 [打包校验回执](verification/package-verification.json)

## 使用与实现状态

将 `skills/hk-factor-backtest` 目录安装到 Codex 的 skills 目录后，使用 `$hk-factor-backtest` 并明确提供本次因子定义、行情目录、执行入口和来源名称。也可直接阅读 SKILL.md 按流程执行。已有同名 skill 时先核对版本和本地修改。

本仓库交付的是 **v6 流程、模板、配置和继承参考源码**。`scripts` 内的旧引擎尚未通过 v6 的 20 日、开盘入场、共享现金与统一报告验收；仍含旧周期常量和旧报告实现。正式运行前须按流程适配指定入口并完成数值与页面验收，不能直接用示例配置把旧实现视为 v6 引擎。

项目根目录的 `run_backtest.py` 是输出目录管理启动器，不会替代上述引擎适配。使用时显式指定入口与数据，先以 `--dry-run` 检查命令。新结果统一写入本地 `output/来源-YYYY-MMDD-回测结果`，不得覆盖历史批次。

## 本次核对范围

已核对历史批次的 138 个单因子日期、真实训练行索引、收益标签到期日及冻结模型哈希。单因子实际日期为 2010-01-04 至 2022-12-30；训练样本与标签越过 2022 年末的数量均为 0。核对证据包含等权基线、Ridge、LightGBM 的记录。

历史结果仍是原 21 日计算，未重算、未改标为 20 日。20 日是本版流程的新默认规范。包内日期回执证明历史结果的时间边界，不代表新的 20 日引擎已执行。

仓库不包含原始行情、训练模型或完整历史回测数据。模板快照为原版页面与交互参考，旧标题和参数须按新批实际数据适配后才能发布报告。
