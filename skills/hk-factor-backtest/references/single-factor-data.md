# 通用单因子可视化数据接口

`scripts/render_single_factor.py --data <JSON> --output <目录>` 接受UTF-8 JSON。数值必须有限，缺失用null，未计算的数组为空；页面不推断新的回测口径。文件应以report-input.json保存在本批目录，支持重复生成同一页面。

| 顶层字段 | 记录内容 |
|---|---|
| meta | title、source、description；可选note、footer、statistics（value/label）、default_context、dimensions（key/label） |
| factors | 唯一id、name、status、formula（普通公式文本，MathML排版）、parameters、calculation_method、economic_meaning；可选short_name、experiment、missing_details、downloads |
| contexts | 唯一id、label、description；使用分项筛选时含dimensions对象，覆盖meta.dimensions中的每个key，每个值为展示文本 |
| results | 唯一id、factor_id、context_id、variant、preferred、parameters、description、ic_mean、raw_ic、direction_multiplier、dates、ic_series、portfolios、groups；可选payload、payload_key、downloads |
| correlations | id、context_id、method、ids、values；values为方阵，缺失null；可选days和overlap方阵 |
| experiments / method | title、text，可选downloads |
| notes | 可选；title、text，研究笔记不计为因子 |
| downloads | label、href；指向输入JSON所在目录内实际存在的相对文件，输出到其他目录时渲染器自动复制 |

未指定meta.dimensions时使用单个评估设置下拉框；指定时各维度共同唯一确定context。实验数量、名称、日期、组数和持有期均不固定。results的factor_id/context_id/variant组合必须唯一。没有多个参数版本时可以不填variant和preferred；preferred=false表示该版本不在“仅选定版本”视图，但可在全部版本与详情中查看。

portfolios与groups每项包含唯一id、label、role（LS或long）、active、nav、annualized_return（算术年化净收益）、cagr（复合年化）、sharpe、drawdown、annual（年份到收益映射）。可附final_nav、cumulative_return、volatility、gross_sharpe、annualized_fee_rate、win_rate、active_entries。portfolios通常为多空和最高组，groups保留全部组。active=false表示未开仓；数值0不能当作缺失。

nav、ic_series及可选pearson_ic/cumulative_ic/drawdown与同条dates等长。dates唯一并递增。年度收益从完整序列核对后输入，保留每年首个交易日，不由浏览器重新计算。内置状态适配器的年度导出按年末净值/上年末净值−1，首年初始资金1，非正分母保留缺失；该导出另存visualization_annual_returns.csv。

因子status仅表达计算可用性（completed、blocked、no_entries、failed等），不能用作好坏分类。原result.status/selected等筛选字段可以随证据存档，但页面不据此筛除或分组。总览和分组收益图使用annualized_return，缺失时不以cagr补齐；完整指标表同时列出两种年化。默认视图为总览／单因子／全部因子。

## 大型报告与离线分片

将指标留在results，逐日序列另存分片。使用渲染器的 `write_payload(path, key, payload)` 写入本地JS，设置result.payload为相对文件名、payload_key为key。payload包含dates、ic_series、pearson_ic、cumulative_ic、drawdown，及portfolios/groups的id/nav。分片不改变结果ID、评估设置或已保存指标。渲染器校验分片内容和引用，页面内置加载逻辑，无须修改生成后的JS。分片与数据文件必须随dashboard一并保留。

渲染器向旧接口兼容：单版本结果省略id时用factor_id/context_id生成；相关矩阵省略id时自动生成。完整精度指标、覆盖、逐股原值、独立零费账本和验证通过本批downloads交付；不能以展示接口为由删减回测证据。
