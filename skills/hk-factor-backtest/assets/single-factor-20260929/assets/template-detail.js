'use strict';
window.renderTemplateDetail=function(s,r){const $=id=>document.getElementById(id);if(!$('group-chart'))return;
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,n=3)=>v===null||v===undefined||v===''?'—':Number(v).toFixed(n),pct=v=>v===null||v===undefined||v===''?'—':(Number(v)*100).toFixed(2)+'%';
const config={responsive:true,displaylogo:false},base=()=>({paper_bgcolor:'#fff',plot_bgcolor:'#fff',font:{family:'Segoe UI,Microsoft YaHei,sans-serif',size:12,color:'#415969'},margin:{l:65,r:25,t:40,b:90},legend:{orientation:'h',y:-.2},height:430});
if(!s){for(const id of ['group-chart','group-lines']){Plotly.purge(id);$(id).innerHTML='<p class="empty">该设置未复制分组曲线；不使用其他定向或阶段替代。</p>'}for(const id of ['annual-table','group-table'])$(id).innerHTML='';return;}
const gm=s.group_metrics||[],labels=Array.from({length:20},(_,i)=>'Q'+String(i+1).padStart(2,'0'));let l=base();l.title='20组扣费算术年化收益';l.yaxis={tickformat:'.0%'};Plotly.react('group-chart',[{x:gm.map(g=>g.portfolio),y:gm.map(g=>g.annualized_return===''?null:Number(g.annualized_return)),type:'bar',marker:{color:gm.map(g=>g.portfolio==='Q20'?'#087f79':g.portfolio==='Q01'?'#bb6851':'#a1bbb1')}}],l,config);
l=base();l.title='20组独立多头净值';l.height=520;l.margin.b=130;Plotly.react('group-lines',labels.filter(q=>s[q.toLowerCase()+'_nav']&&Number(gm.find(g=>g.portfolio===q)?.active_entries)>0).map(q=>({x:s.date,y:s[q.toLowerCase()+'_nav'],name:q,type:'scatter',mode:'lines'})),l,config);
const table=(id,headers,rr)=>$(id).innerHTML='<table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rr.map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
const yr=[...new Set((s.annual||[]).map(y=>y.year))];table('annual-table',['年份','多空净收益','Q20多头净收益','覆盖起止'],yr.map(y=>{const ls=s.annual.find(v=>v.year===y&&v.portfolio==='LS'),lo=s.annual.find(v=>v.year===y&&v.portfolio==='Q20');return [y,Number(r.active_entries)===0?'—':pct(ls?.net_return),pct(lo?.net_return),(ls?.start||lo?.start)+' — '+(ls?.end||lo?.end)]}));
table('group-table',['分组','净CAGR','净Sharpe','毛Sharpe','最大回撤','累计收益','有效开仓'],gm.map(g=>[g.portfolio,pct(g.cagr),num(g.net_sharpe||g.sharpe),num(g.gross_sharpe),pct(g.max_drawdown),pct(g.cumulative_return),g.active_entries]));
};
