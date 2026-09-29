# 港股回测框架

港股单因子研究、多因子训练、每日滚动持仓及统一可视化的 skill 流程包。

当前规范版本：`2026-09-29.adjusted-quantity-v11`。

## 核心口径

- 因子成交量、成交额直接来自对应后复权表（现金分红／分红再投）；VWAP为同口径 amount/volume。缺字段不回退原始数据。股票可选性、5日平均成交额严格大于300万港元及可交易性继续使用不复权数据。供应商量额若相同则如实保留。

- 单因子回测与多因子训练仅使用 **2010-01-01 至 2022-12-31**；方向、IC、因子值相关性、去重及筛选同样受此边界约束。
- 训练信号、入场和收益标签到期日必须全部落在训练区间，清除跨年末的未成熟标签。
- **2023–2025 仅用于冻结后的组合测试**，不能进入拟合、选库、调参、方向选择或 early stopping。
- 默认 **20 个市场交易日持仓，每日滚动**：信号 t 收盘、t+1 开盘入场、t+21 收盘到期。已结算现金共享复用，停牌到期残仓独立管理。
- 因子去重采用训练期月末共同有限股票截面的 **Spearman 秩相关**：先取交集再分别取平均秩（至少20只，并列平均秩，不作IC缩尾），对有符号ρ按有效日期等权平均，再按 |平均ρ| > 0.8 去重。去重不使用原值 Pearson，也不计算 IC 序列之间的相关性。
- 单因子可视化采用 **独立通用视觉模板**，按更正后的LLM基本面页面复用布局与交互，不携带历史实验数据；采用总览／单因子／全部因子，仅展示、不分好坏；多因子组合继续采用 TA-Lib双因子库模板。包含完整单因子详情、渲染后的公式、经济含义推测、IC、分组、收益与指标。

具体约束、例外与验收标准以 [SKILL.md](skills/hk-factor-backtest/SKILL.md) 及其引用文档为准。

## 文件入口

- [最新完整流程包 ZIP](dist/hk-factor-backtest-adjusted-quantity-v11.zip) 与 [SHA-256](dist/hk-factor-backtest-adjusted-quantity-v11.zip.sha256)
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

本仓库交付的是 **v10 流程、Spearman去重、单因子默认模板、报告入口适配、配置和继承计算源码**。内置 `run.py run/report` 的报告发布已接入共享单因子模板，保存结果映射通过真实样本检验；`scripts` 内交易计算仍未通过20日、开盘入场与共享现金的新口径验收。正式运行前须按流程适配指定入口并完成数值与页面验收，不能直接用示例配置把旧实现视为 v6 引擎。

项目根目录的 `run_backtest.py` 是输出目录管理启动器，不会替代上述引擎适配。使用时显式指定入口与数据，先以 `--dry-run` 检查命令。新结果统一写入本地 `output/来源-YYYY-MMDD-回测结果`，不得覆盖历史批次。

## 历史日期核对范围

已核对历史批次的 138 个单因子日期、真实训练行索引、收益标签到期日及冻结模型哈希。单因子实际日期为 2010-01-04 至 2022-12-30；训练样本与标签越过 2022 年末的数量均为 0。核对证据包含等权基线、Ridge、LightGBM 的记录。

历史结果仍是原 21 日计算，未重算、未改标为 20 日。20 日是本版流程的新默认规范。包内日期回执证明历史结果的时间边界，不代表新的 20 日引擎已执行。

仓库不包含原始行情、训练模型或完整历史回测数据。模板快照为原版页面与交互参考，旧标题和参数须按新批实际数据适配后才能发布报告。

## 单因子默认模板

视觉基准是用户更正后的 `LLM基本面时点研究-2026-0926-回测结果/backtest/dashboard.html`。基础CSS与参考逐字节一致；复用纸灰背景、青绿与砖红配色、衬线标题、散点总览、相关矩阵及单因子多图布局。模板不内置历史作者、因子、日期或业绩。

默认三页签为总览／单因子／全部因子，仅制作展示，不区分好坏、不按原筛选结论隐藏因子。保留全部候选的公式、参数与计算状态，提供原始收益、IC、完整分组、年度收益和本地证据下载。算术年化收益与CAGR明确区分，缺失数据不补造；支持本地JS分片按需加载和离线浏览。

- [模板与交互规范](skills/hk-factor-backtest/references/single-factor-report.md)
- [数据接口](skills/hk-factor-backtest/references/single-factor-data.md)
- [页面与资源清单](skills/hk-factor-backtest/assets/single-factor-generic/template.json)
- [模板验证回执](verification/generic-template-verification.json)

内置报告调用链为 `standalone_report.publish → single_factor_from_state.publish → render_single_factor.render`。其他引擎导出接口JSON后运行 `python scripts/render_single_factor.py --data <本次JSON> --output <本次目录>`。渲染器预检本地引用、唯一设置、有限数值、矩阵和序列长度，再生成报告。

v9单因子模板通过7项契约/公式测试、真实旧结果映射及浏览器桌面/窄屏检查。旧实验的参数、方向、IC和业绩保持不变；生成页面的校验不替代回测数值验证。v6/v7/v8/v9 ZIP保留为历史下载，以本页顶部v10包为默认。

## Spearman 去重更新

v10统一主流程、单因子与多因子规范、示例配置、报告方法说明和入口元数据。内置相关性函数原本已按共同股票重排秩；本次将平均秩明确写入计算，配置固定 `correlation_method="spearman"`，拒绝原值Pearson去重设置，并将详细规则保存至配置、因子payload、相关矩阵、筛选证据和缓存指纹。报告按已保存的实际方法展示，历史缺少方法的结果保持未知。Pearson IC仍可作为因子与未来收益的辅助统计；它不参与因子去重。

通过24项回归测试，涵盖单调非线性重复、正负相关、并列与缺失交集、常数、20只下限、0.8/0.01边界、CLI结果与报告方法传递及历史方法保留。另取已保存的6个真实因子、2010–2022年156个月末、2767只证券，逐对逐月对照SciPy `spearmanr`；平均矩阵最大绝对误差为2.23×10⁻¹⁶以内，月数和共同股票数一致，源文件哈希未变。

- [Spearman数值与回归检验回执](verification/spearman-dedup-verification.json)
- [24项回归测试日志](verification/regression-tests.txt)
- [新增去重回归用例](skills/hk-factor-backtest/scripts/test_dedup_spearman.py)

在 `skills/hk-factor-backtest/scripts` 中执行 `python -m unittest test_dedup_spearman test_standalone test_single_factor_template test_formula_display -v` 可运行回归。现有内置交易实现的旧周期测试用于验证兼容性，不代表20日新账本已完成认证；本次不重算历史业绩、不重新选择历史冻结因子库。
