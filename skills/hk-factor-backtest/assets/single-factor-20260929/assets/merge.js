'use strict';
const D=window.REPORT,$=id=>document.getElementById(id);
const names={grid:'16因子网格',dual:'双作者',mixed:'历史混合来源'};
const statuses={completed:'已有回测',not_evaluable:'缺定义/数据',blocked_data:'缺数据',blocked_definition:'缺定义',blocked_strategy:'策略待补'};
const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=(x,p=4)=>x===null||x===undefined||x===''?'—':Number.isFinite(Number(x))?Number(x).toFixed(p):e(x);
function tab(){let id=location.hash.slice(1)||'results';if(!$(id))id='results';document.querySelectorAll('section.page').forEach(x=>x.classList.toggle('active',x.id===id));document.querySelectorAll('nav a').forEach(x=>x.classList.toggle('active',x.hash==='#'+id));if(id==='results')results();}
function catalog(){const q=$('search').value.toLowerCase();const rr=D.catalog.filter(f=>(!$('batch').value||f.batch===$('batch').value)&&(!$('status').value||($('status').value==='completed'?f.status==='completed':f.status!=='completed'))&&(!q||[f.name,f.id,f.formula,f.economic_meaning].join(' ').toLowerCase().includes(q)));
$('count').textContent=`显示 ${rr.length} / ${D.catalog.length} 条；点击名称展开公式与结果。`;
$('catalog').innerHTML='<table class="catalog-table"><thead><tr><th>因子 / 来源</th><th>公式</th><th>隐含经济含义（假设）</th><th>状态</th></tr></thead><tbody>'+rr.map(f=>`<tr><td><a href="${e(f.detail)}">${e(f.name)}</a><br><small>${e(names[f.batch])} · ${e(f.id)}</small></td><td>${e(f.formula)}<br><small>${e(f.formula_status)}</small></td><td>${e(f.economic_meaning)}</td><td>${e(statuses[f.status]||f.status)}</td></tr>`).join('')+'</tbody></table>';}
let sortKey='name',sortDir=1;
function results(){const rr=D.settings.filter(r=>r.batch===$('rbatch').value&&r.stage===$('stage').value&&r.result_kind===$('kind').value&&r.mode===$('mode').value&&r.hold_days===Number($('hold').value)&&($('variants').value==='all'||r.selected_variant));
rr.sort((a,b)=>{let x=a[sortKey],y=b[sortKey];if(typeof x==='number'&&typeof y==='number')return (x-y)*sortDir;return String(x??'').localeCompare(String(y??''))*sortDir});
const columns=[['name','因子'],['variant','版本/参数'],['preorientation_rank_ic','原IC'],['ic_mean','当前IC'],['direction_multiplier','方向乘数'],['net_sharpe','净Sharpe'],['cagr','净CAGR'],['max_drawdown','最大回撤'],['status','状态']];
$('result-table').innerHTML=rr.length?'<table><thead><tr>'+columns.map(([k,v])=>`<th class="${sortKey===k?'sorted':''}"><button class="sort" data-sort="${k}">${v}${sortKey===k?(sortDir===1?' ↑':' ↓'):''}</button></th>`).join('')+'</tr></thead><tbody>'+rr.map(r=>'<tr>'+columns.map(([k])=>{if(k==='name')return `<td><a href="factors/${e(r.uid)}.html">${e(r.name)}</a></td>`;return `<td>${['name','variant','status'].includes(k)?e(r[k]):n(r[k],k==='direction_multiplier'?0:4)}</td>`}).join('')+'</tr>').join('')+'</tbody></table>':'<div class="empty">此组合没有运行结果。全历史实验请选择“全历史”和“原官方／基线”；冻结方向仅有验证与测试。</div>';
document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{const k=b.dataset.sort;sortDir=sortKey===k?-sortDir:1;sortKey=k;results()});
const points=rr.filter(r=>r.ic_mean!==null&&r.annualized_return!==null&&r.annualized_return!==undefined);
Plotly.react('scatter',[{x:points.map(r=>r.ic_mean),y:points.map(r=>r.annualized_return),text:points.map(r=>r.name+' / '+r.variant),mode:'markers',type:'scatter',marker:{color:'#087f79',size:9},hovertemplate:'%{text}<br>IC %{x:.4f}<br>算术年化 %{y:.2%}<extra></extra>'}],{title:{text:rr.length?`${names[$('rbatch').value]} · ${rr.length} 个设置`:'当前选择无结果',font:{size:16}},xaxis:{title:'Mean Rank IC'},yaxis:{title:'扣费多空算术年化收益',tickformat:'.0%'},margin:{l:70,r:25,t:55,b:55},paper_bgcolor:'#fff',plot_bgcolor:'#fff'},{responsive:true,displaylogo:false});}
['batch','status','search'].forEach(id=>$(id).addEventListener('input',catalog));
['rbatch','stage','kind','mode','hold','variants'].forEach(id=>$(id).addEventListener('change',()=>{if(id==='rbatch'){$('stage').value=$('rbatch').value==='grid'?'test':'full';$('kind').value='official'}results()}));
$('note-list').innerHTML='<ol>'+D.notes.map(r=>`<li>${e(r.name)}<br><small>${e(r.record_id)} · ${e(r.next_action)}</small></li>`).join('')+'</ol>';
window.addEventListener('hashchange',tab);catalog();tab();
