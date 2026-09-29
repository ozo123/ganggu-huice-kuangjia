'use strict';
(()=>{const D=window.DETAIL,$=id=>document.getElementById(id);if(!$('setting'))return;
const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const v=x=>x===null||x===undefined||x===''?'—':typeof x==='number'?Number.isInteger(x)?String(x):x.toPrecision(8):typeof x==='object'?JSON.stringify(x):String(x);
const stage={train:'训练2010—2019',validation:'验证2020—2022',test:'测试2023—2025',full:'全历史2010—2026'};
const ordered=D.map((r,i)=>({r,i})).sort((a,b)=>Number(b.r.selected_variant)-Number(a.r.selected_variant));
$('setting').innerHTML=ordered.map(({r,i})=>`<option value="${i}">${e(stage[r.stage])} / ${r.result_kind==='frozen'?'冻结方向':'原官方/基线'} / ${e(r.variant)} / ${r.mode} / ${r.hold_days}日${r.selected_variant?'':' / 非选定参数'}</option>`).join('');
let revision=0;
function render(){let r=D[Number($('setting').value)],rev=++revision;
$('selected-note').textContent=`${r.policy}；方向乘数 ${v(r.direction_multiplier)}；状态 ${r.status||'未提供'}。当前公式的实际参数：${v(r.actual_parameters||r.value||r.variant)}。`;
const labels={ic_mean:'当前Mean Rank IC',preorientation_rank_ic:'原Mean Rank IC',direction_multiplier:'方向乘数',net_sharpe:'扣费多空Sharpe',gross_sharpe:'毛Sharpe',cagr:'净CAGR',max_drawdown:'最大回撤',annualized_return:'算术年化收益',ic_tstat:'IC HAC t',ic_ir:'ICIR',ic_n:'IC有效日数',annualized_fee_rate:'年化费用率',final_nav:'末净值',active_entries:'有效开仓',bh_q:'BH q值',passes:'补充门槛',reason:'筛选原因',blocked_by:'相关性冲突证据'};
$('metrics').innerHTML='<table><thead><tr><th>指标</th><th>原值</th></tr></thead><tbody>'+Object.entries(labels).map(([k,l])=>`<tr><td>${e(l)}</td><td>${e(v(r[k]))}</td></tr>`).join('')+'</tbody></table>';
$('series-download').innerHTML=r.series_csv?`<a href="../${e(r.series_csv)}">完整逐日曲线与IC CSV</a><a href="../${e(r.raw_series)}">原始完整序列 Parquet</a>`:'<span>该设置未在整合页复制曲线；已保存全部原始指标，可由上方原始报告查看。</span>';
if(!r.curve){if(window.renderTemplateDetail)window.renderTemplateDetail(null,r);Plotly.purge('curve');Plotly.purge('ic-curve');$('curve').innerHTML='<p class="empty">'+(r.result_kind==='frozen'?'冻结方向补充检验仅展示已导出的指标；不以官方曲线替代。':'没有可用的逐日曲线。')+'</p>';$('ic-curve').innerHTML='';return;}
let script=document.createElement('script');script.src='../'+r.curve;
script.onload=()=>{script.remove();if(rev!==revision)return;const s=window.FACTOR_SERIES;if(window.renderTemplateDetail)window.renderTemplateDetail(s,r);
const active=r.active_entries===undefined||r.active_entries===null||Number(r.active_entries)>0;
const traces=[];if(active&&r.net_sharpe!==null)traces.push({x:s.date,y:s.ls_nav,name:'多空净值',type:'scatter',line:{color:'#087f79'}});
if(s.q20_nav&&Number(s.group_metrics?.find(g=>g.portfolio==='Q20')?.active_entries)>0)traces.push({x:s.date,y:s.q20_nav,name:'Q20多头净值',type:'scatter',line:{color:'#32639b',dash:'dot'}});
if(s.q01_nav&&Number(s.group_metrics?.find(g=>g.portfolio==='Q01')?.active_entries)>0)traces.push({x:s.date,y:s.q01_nav,name:'Q01多头净值',type:'scatter',line:{color:'#a06f43',dash:'dot'}});
Plotly.react('curve',traces,{title:'净值 · 原始逐日观测',xaxis:{title:'日期'},yaxis:{title:'净值',type:'linear'},legend:{orientation:'h',y:-.25},margin:{l:65,r:20,t:50,b:90}},{responsive:true,displaylogo:false});
Plotly.react('ic-curve',[{x:s.date,y:s.ic,name:'每日Rank IC',type:'scatter',line:{color:'#087f79',width:1}},{x:s.date,y:s.cum_ic,name:'累计IC',yaxis:'y2',type:'scatter',line:{color:'#a06f43'}}],{title:'IC时序与累计IC',xaxis:{title:'日期'},yaxis:{title:'Rank IC'},yaxis2:{title:'累计IC',overlaying:'y',side:'right'},legend:{orientation:'h',y:-.25},margin:{l:65,r:70,t:50,b:90}},{responsive:true,displaylogo:false});};
script.onerror=()=>{script.remove();$('curve').textContent='曲线文件加载失败，请检查相邻series目录。'};document.body.appendChild(script);}
$('setting').addEventListener('change',render);render();})();
