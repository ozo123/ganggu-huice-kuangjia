const D=window.REPORT,$=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const finite=x=>x!==null&&x!==undefined&&Number.isFinite(Number(x));
const num=(x,n=3)=>finite(x)?Number(x).toFixed(n):'—',pct=x=>finite(x)?(100*x).toFixed(2)+'%':'—';
const modeName={cash:'现金分红',reinvest:'红利再投'},modelName={ridge:'Ridge',lightgbm:'LightGBM'},selectionName={q20:'20组两端',top20:'各20只'},strategyName={long_short:'多空各半',long_only:'只做多'};
const chartConfig={responsive:true,displaylogo:false,scrollZoom:false,toImageButtonOptions:{format:'png',scale:2}};
const layout=(title='')=>({paper_bgcolor:'#fff',plot_bgcolor:'#fff',font:{family:'Segoe UI, Microsoft YaHei, sans-serif',size:12,color:'#415969'},margin:{l:68,r:24,t:25,b:60},hovermode:'x unified',xaxis:{gridcolor:'#eff2ef',showline:true,linecolor:'#cedad4'},yaxis:{title,gridcolor:'#e9efeb',zerolinecolor:'#cedad4'},legend:{orientation:'h',y:-.18,x:0,font:{size:11}},height:530});
function table(host,rows,cols,defaultKey=null){
  let order=defaultKey,ascending=false;
  function paint(){
    const data=[...rows];
    if(order){const col=cols.find(c=>c.key===order);data.sort((a,b)=>{let x=col.value?col.value(a):a[order],y=col.value?col.value(b):b[order];if(x===null||x===undefined)return 1;if(y===null||y===undefined)return -1;return (typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y)))*(ascending?1:-1)});}
    host.innerHTML='<table><thead><tr>'+cols.map(c=>'<th tabindex="0" data-key="'+esc(c.key)+'" class="'+(order===c.key?'sorted':'')+'" aria-sort="'+(order===c.key?(ascending?'ascending':'descending'):'none')+'">'+esc(c.label)+(order===c.key?(ascending?' ↑':' ↓'):' ↕')+'</th>').join('')+'</tr></thead><tbody>'+data.map(row=>'<tr>'+cols.map(c=>'<td>'+ (c.render?c.render(row):esc(c.format?c.format(c.value?c.value(row):row[c.key]):(c.value?c.value(row):row[c.key])??'—'))+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
    host.querySelectorAll('th').forEach(th=>{const change=()=>{ascending=order===th.dataset.key?!ascending:false;order=th.dataset.key;paint()};th.addEventListener('click',change);th.addEventListener('keydown',e=>{if(e.key==='Enter')change()});});
    if(!rows.length)host.insertAdjacentHTML('beforeend','<p class="empty">没有符合当前筛选的记录。</p>');
  }paint();
}
function seriesName(r,withMode=false){return (withMode?modeName[r.mode]+' · ':'')+r.library+'号 / '+modelName[r.model]+' / '+selectionName[r.selection]+' / '+strategyName[r.strategy]}
function allowed(r){
  const mode=$('#strategy-mode').value,scope=$('#scope').value;
  if(r.scope!==scope||(mode!=='both'&&r.mode!==mode))return false;
  return ['library','model','selection','strategy'].every(k=>$$('#model-filters input[data-key="'+k+'"]:checked').some(el=>String(r[k])===el.value));
}
function modelRender(){
  const all=$('#strategy-mode').value==='both',rows=D.models.filter(allowed),series=D.series.filter(allowed);
  const colors=['#087f79','#dd7048','#395e98','#ab4771','#6b7d27','#8765aa','#2886a4','#946741','#435971','#e29721','#4a9e70','#c05c67','#567fa7','#997b47','#b5528c','#639eac'];
  const traces=series.map((r,i)=>({x:r.dates,y:r.nav,type:'scatter',mode:'lines',name:seriesName(r,all),line:{color:colors[i%16],width:r.model==='lightgbm'?2:1.6,dash:r.strategy==='long_only'?'dot':'solid'},hovertemplate:'%{y:.4f}<extra>%{fullData.name}</extra>'}));
  let l=layout('扣费净值');l.height=all?700:590;l.yaxis.type=$('#scale').value;l.legend.y=-.16;l.margin.b=160;l.uirevision='models-'+$('#scope').value+'-'+$('#strategy-mode').value;
  if(series.length)l.xaxis.range=[series[0].dates[0],series[0].dates[series[0].dates.length-1]];
  Plotly.react('strategy-chart',traces,l,chartConfig);
  $('#model-note').textContent=($('#scope').value==='test'?'测试期 2023–2025：因子清单、模型参数、拟合权重和评分方向已在 2022 年底冻结。测试期初以现金 1 独立启动。':'拟合期 2010–2022：这是使用整个训练期拟合后的样本内收益诊断，不能视为逐年真实可交易的历史策略。')+' 当前显示 '+rows.length+' 条策略；实线为多空，点线为只做多。';
  table($('#model-table'),rows,[{key:'name',label:'策略',value:r=>seriesName(r,all)},{key:'cagr',label:'净 CAGR',format:pct},{key:'sharpe',label:'净 Sharpe',format:num},{key:'max_drawdown',label:'最大回撤',format:pct},{key:'cumulative_return',label:'累计收益',format:pct},{key:'volatility',label:'年化波动',format:pct},{key:'ic_mean',label:'Mean Rank IC',format:x=>num(x,4)},{key:'ic_ir',label:'ICIR',format:num},{key:'gross_sharpe',label:'毛 Sharpe',format:num},{key:'annualized_fee_rate',label:'年化费用率',format:pct},{key:'win_rate',label:'日胜率',format:pct}], 'cagr');
  const years=D.years.filter(allowed),yearSet=[...new Set(years.map(r=>r.year))].sort();
  const yr=rows.map(row=>({...row,...Object.fromEntries(years.filter(y=>y.mode===row.mode&&y.library===row.library&&y.model===row.model&&y.selection===row.selection&&y.strategy===row.strategy).map(y=>['y'+y.year,y.net_return]))}));
  table($('#year-table'),yr,[{key:'name',label:'策略',value:r=>seriesName(r,all)},...yearSet.map(y=>({key:'y'+y,label:String(y),format:pct}))]);
  if(!all)headerCounts($('#strategy-mode').value);
}
function headerCounts(mode){const x=D.libraries[mode+'__21'];$('#count-library1').textContent=x.library1.length;$('#count-library2').textContent=x.library2.length;$('#count-library1').nextElementSibling.textContent='1 号库 · '+modeName[mode];$('#count-library2').nextElementSibling.textContent='2 号库 · '+modeName[mode];}
const factorCols=[{key:'factor_id',label:'因子 / 计算方式',render:r=>'<a href="factors/'+encodeURIComponent(r.factor_id)+'/index.html" title="'+esc(r.name)+'">'+esc(r.factor_id)+'</a>'},{key:'preorientation_rank_ic',label:'原 Mean IC',format:x=>num(x,4)},{key:'ic_mean',label:'定向 Mean IC',format:x=>num(x,4)},{key:'ic_ir',label:'ICIR',format:num},{key:'ic_tstat',label:'HAC t',format:num},{key:'ic_n',label:'IC天数'},{key:'direction_multiplier',label:'方向',format:x=>x===-1?'−1':'＋1'},{key:'cagr',label:'多空 CAGR',format:pct},{key:'net_sharpe',label:'多空 Sharpe',format:num},{key:'max_drawdown',label:'多空回撤',format:pct},{key:'lo_cagr',label:'只多 CAGR',format:pct},{key:'lo_sharpe',label:'只多 Sharpe',format:num},{key:'status_label',label:'去留结果'}];
function factorRender(section){
  const mode=section.querySelector('.factor-mode').value,query=section.querySelector('.factor-search').value.toLowerCase().trim(),lib=section.id==='library1'?1:section.id==='library2'?2:null;
  let rows=D.tables[mode].filter(r=>(!lib||r['library'+lib])&&(!query||(r.factor_id+' '+r.name+' '+r.group).toLowerCase().includes(query)));
  if(section.id==='all'){let status=$('#factor-status').value;if(status!=='all')rows=rows.filter(r=>status==='selected'?r.library1:!r.library1)}
  table(section.querySelector('.factor-table'),rows,factorCols,lib?'ic_mean':null);
  if(lib){let ids=D.libraries[mode+'__21']['library'+lib],cm=D.correlation.modes[mode].matrix,map=D.correlation.ids,high=0;for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++)high=Math.max(high,Math.abs(cm[map.indexOf(ids[i])][map.indexOf(ids[j])]));section.querySelector('.library-note').textContent=modeName[mode]+'：保留 '+ids.length+' 个因子，库内最大 |ρ| = '+num(high,6)+'。当前搜索显示 '+rows.length+' 个。全部指标来自 2010–2022 年的 21 天单因子回测。';section.querySelector('.matrix-download').href='library'+lib+'/'+mode+'_21d/similarity.csv';}
  headerCounts(mode);
}
function corrRender(){
  const mode=$('#corr-mode').value,lib=$('#corr-library').value,cm=D.correlation.modes[mode],all=D.correlation.ids,ids=lib==='all'?all:D.libraries[mode+'__21']['library'+lib],ix=ids.map(x=>all.indexOf(x));
  let high=0,conflicts=0,unknown=0;
  const z=ix.map((i,a)=>ix.map((j,b)=>{let x=cm.matrix[i][j];if(a<b){if(x===null)unknown++;else{high=Math.max(high,Math.abs(x));if(Math.abs(x)>.8)conflicts++}}return x===null?null:Math.abs(x)}));
  const text=ix.map((i,a)=>ix.map((j,b)=>ids[a]+' × '+ids[b]+'<br>ρ = '+num(cm.matrix[i][j],6)+'<br>有效月末 = '+cm.days[i][j]+'<br>平均共同股票 = '+num(cm.overlap[i][j],1)));
  const l=layout();l.height=Math.max(620,Math.min(920,ids.length*7+240));l.margin={l:175,r:35,t:15,b:165};l.hovermode='closest';l.xaxis={tickangle:-60,tickfont:{size:9},automargin:true};l.yaxis={tickfont:{size:9},automargin:true,autorange:'reversed'};
  Plotly.react('correlation-chart',[{z,x:ids,y:ids,type:'heatmap',zmin:0,zmax:1,colorscale:[[0,'#fbfcfa'],[.4,'#acd0c2'],[.8,'#167f76'],[1,'#b44d3b']],text,hovertemplate:'%{text}<extra></extra>',colorbar:{title:'|ρ|'}}],l,chartConfig);
  $('#corr-note').textContent=ids.length+' 个因子 · 非对角最大 |ρ| = '+num(high,6)+' · 大于 0.8 的因子对 '+conflicts+' 对 · 无法定义 '+unknown+' 对。相似度使用未缩尾的原始因子值，不使用未来收益。';
  $('#corr-download').href='correlation_'+mode+'.csv';headerCounts(mode);
}
function navigate(){
  let id=location.hash.slice(1)||'strategies';if(!['strategies','library1','library2','all','similarity','method'].includes(id))id='strategies';
  $$('.page').forEach(s=>s.classList.toggle('active',s.id===id));$$('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#'+id));
  if(id==='strategies')modelRender();else if(['library1','library2','all'].includes(id))factorRender($('#'+id));else if(id==='similarity')corrRender();
}
$('#method-text').innerHTML=D.method.split(/\n\n+/).filter(x=>!x.startsWith('# ')).map(x=>'<p>'+esc(x)+'</p>').join('');
$$('#strategy-mode,#scope,#scale,#model-filters input').forEach(el=>el.addEventListener('change',modelRender));
$$('.factor-mode,.factor-search,#factor-status').forEach(el=>el.addEventListener(el.type==='search'?'input':'change',()=>factorRender(el.closest('section'))));
$$('#corr-mode,#corr-library').forEach(el=>el.addEventListener('change',corrRender));window.addEventListener('hashchange',navigate);headerCounts('cash');navigate();
