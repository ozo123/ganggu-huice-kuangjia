# 输入契约

配置路径相对配置文件目录；`data_manifest` 中的文件相对 data_root。命令行可指定数据根目录、因子文件、输出目录、上市日文件等。单因子回测与多因子训练只允许2010-01-01至2022-12-31；`start,end`不能因默认值、行情覆盖或命令行覆盖自动扩展到区间外。多因子测试使用单独的`test_start,test_end`，不得覆盖训练边界。输出独立于源目录，不改原数据。

## 日线数据

内置读取现有iFind根目录 `metadata/eleven_current_*.json`（取最新文件）中mode 1/7/3对应的不复权、后复权现金、后复权再投。按口径子目录重定位旧清单路径，不混入同一年的旧修复版本。本机该配置沿用HKD单位、排除币种未核实的80737.HK；这不是其他数据源的普遍排除规则。

其他源提供 `raw.parquet,cash.parquet,reinvest.parquet`（或CSV），配置明确 `currency: HKD, amount_unit: HKD`；也可指定清单：

```json
{"currency":"HKD","amount_unit":"HKD","files":{"raw":["raw/2024.parquet"],"cash":["cash/2024.parquet"],"reinvest":["reinvest/2024.parquet"]}}
```

主键 `code,date`，code保留字符串（如0700.HK），date为ISO日期。三类都需open/high/low/close，不复权另需volume/amount，可选preClose/turnoverRatio。复权表量额不使用。非正价格、负量额为缺失；已知零量额保留。重复主键、跨分片重叠报错，不静默取最后记录。

`ipo_dates_csv`字段code,listing_date；`allow_observed_age_proxy`默认true，缺IPO时用首个有效成交日起6自然月代理并披露。false则缺IPO者排除。`codes`用于明确指定股票范围或验证；`start=2010-01-01,end=2022-12-31`限定单因子模拟和IC。默认从2010年起的历史计算信号，预热不足保持缺失。正式上市日期可早于该区间，不能把真实上市年限改为从回测起点起算。

`event_overrides`可提供数组JSON，字段code,date,share_ratio,cash_per_old_share,source，表示该日每旧股强制股数比例与现金分派，必须有用户数据或核验依据。不得由期望收益反推覆盖值。未提供时使用有披露的日线仿射推断。

## 因子JSON

顶层 `{"factors":[...]}` 或数组，每项示例：

```json
{"id":"reversal_20","name":"20日反转","definition":"负的20交易日收盘收益","frequency":"daily","required_fields":["close"],"expression":"-(close / lag(close, 20) - 1)","direction":1,"lookback":20}
```

ID唯一，ASCII字母数字、短横、下划线，首字符字母或数字；名称可中文。保留公式、参数及provenance。direction默认1代表先验方向；**单因子和组合均仅按2010–2022区间内已成熟标签定向；组合方向在测试前冻结**，翻转乘数相对于先验方向。不要把事后翻转称成事先已知。

字段：本口径open/high/low/close；原始volume/amount/preClose/turnoverRatio/raw_open/raw_high/raw_low/raw_close；vwap=原始amount/原始volume。preClose为原始供应商参考价，不与复权close混算收益。实际无有限观测的字段不能宣称可用。

表达式支持四则、乘方、正负号及lag/delta/mean/std/sum/min/max/corr/rank/abs/log/sqrt/sign。滚动窗口必须完整；std样本标准差；rank当日截面平均秩百分位；corr(x,y,n)为逐股滚动Pearson。窗口与lag仅正整数，无任意eval。未支持的公式继续写经过审阅的Python，不判为市场不适用。

复杂因子用 `python: "relative/implementation.py"` 替代expression，须声明required_fields，接口：

```python
def compute(fields, parameters):
    # fields的值为日期×股票 ndarray；返回同形状数组，缺失NaN。
    # 只含行情字段，不可使用未来行情。
    ...
```

这是可信本地代码，不是沙箱，不直接执行网页代码。引擎比较全序列和三个历史前缀，检测未来shift、居中窗口和全样本标准化；这不是无泄漏数学证明。规定训练区间内的IC定向在信号计算之后单独进行，不把区间外数据带入方向统计。

额外数据写required_external_data字符串数组；非日线写真实frequency。未知公式为pending_implementation；缺数据/定义保留原因。组合策略必须先有独立完整因子定义，不能用单因子回测冒充完整策略复现。

## 公式展示字段
每个因子可提供 `display_formula`（公式文本）、`calculation_method`（变量含义与步骤）、`display_parameters`（实际参数键值）、`calculation_notes`（窗口、缺失/零分母、单位等说明）。Python 因子应补齐变量及窗口定义，不能只展示文件路径。未提供展示公式时，默认采用 `expression`，再回退至 `definition` 或 `source_formula`；缺失时明确显示缺口，不从名称编造。

重建旧报告可在输出目录提供 `factor_descriptions.json`，顶层按因子ID映射上述四个展示字段。它仅补充展示，不修改冻结 `spec`、数值参数或结果；说明必须与实际实现核对。基础公式、先验方向及当前设置的IC翻转分别标明。

## IC winsorize（默认固定口径）

IC 计算默认按每日、每持仓期的共同有限股票截面，对因子值和未来未扣费收益分别进行 1%/99% 分位数 winsorize（线性分位数，替换尾部而非删除股票）；至少20只。Pearson 使用缩尾后的值，Rank IC 在缩尾后重新计算平均秩。缺失保持缺失，常数截面 IC 不可定义。方向翻转、ICIR、HAC t、累计IC和0.01筛选均使用该IC。缩尾只影响IC评估，不直接修改分组信号、因子间相关性、实际收益或费用；IC定向变化仍会触发组合重跑。分位数仅来自当前截面，不跨日期拟合。

原 IC 指缩尾后、方向翻转前的 IC，不是未缩尾 IC。新旧口径不可混用。新运行的配置记录 ic_winsorize，缓存会因实现变更失效；必须执行 run 重新计算，report 只重绘已有数据。
