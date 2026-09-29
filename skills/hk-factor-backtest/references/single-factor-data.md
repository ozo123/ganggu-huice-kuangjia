# 通用可视化数据接口

入口 scripts/render_single_factor.py 接受UTF-8 JSON。数值必须有限，缺失用null；无数据的数组保留为空。该接口仅服务展示，不替代引擎计算。

| 顶层字段 | 记录内容 |
|---|---|
| meta | title、source、description：本次报告标题、来源及口径说明 |
| factors | id、name、status、formula（普通公式文本，页面排版）、parameters（对象）、calculation_method、economic_meaning |
| contexts | id、label、description：任意数量的评估设置，说明实际区间、持仓、复权、方向和费用 |
| results | factor_id、context_id、status、selected（布尔/null）、description、dates、ic_mean、ic_series、portfolios、groups |
| correlations | context_id、method、ids、values（方阵，缺失null），method写明实际样本与方法 |
| experiments / method | title、text组成的实验记录和方法检验条目 |
| downloads | label、href：本次已存在的相对路径，适配器负责复制实际下载文件 |

portfolios/groups每项含id、label、role（LS或long；groups可省略）、active、nav、cagr、sharpe、drawdown、annual（年份到收益映射）。nav、ic_series与同条dates等长。无开仓active=false，不画零收益伪业绩。年度收益由完整序列核验后输入，不由页面猜测。每个factor_id/context_id只一条结果，参数版本、方向不同使用不同context_id。组数、年份、设置数量均动态生成。

更多完整精度指标、IC统计、分组指标、覆盖、逐股值和账本通过downloads交付或扩展页面；不能以最小渲染接口为由丢弃回测规范要求的证据。大型数据可扩展为本地脚本按需分片。
