'use strict';
(() => {
  const D = window.SINGLE_FACTOR_REPORT;
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const num = x => finite(x) ? x.toFixed(4) : '—';
  const pct = x => finite(x) ? (100 * x).toFixed(2) + '%' : '—';
  const F = D.factors, C = D.contexts, R = D.results;
  const factorMap = new Map(F.map(f => [f.id, f]));
  const contextMap = new Map(C.map(c => [c.id, c]));
  const colors = ['#087f79','#dd7048','#395e98','#ab4771','#6b7d27','#8765aa','#2886a4','#946741','#435971','#e29721','#4a9e70','#c05c67','#567fa7','#997b47','#b5528c','#639eac'];
  const color = id => colors[Math.max(0, F.findIndex(f => f.id === id)) % colors.length];
  const statuses = {completed:'已有回测', blocked:'待补定义或数据', not_evaluable:'待补可计算定义', blocked_definition:'待补定义', blocked_data:'待补数据', blocked_strategy:'待补策略实现', no_entries:'未开仓', failed:'计算失败'};
  const statusText = s => statuses[s] || s || '未提供';
  // Screening outcomes remain in source evidence; display only calculation state.
  const calculationState = f => ['selected','passed','correlated','low_ic','rejected','invalid'].includes(f.status)
    ? (R.some(r => r.factor_id === f.id && (r.portfolios?.length || r.payload)) ? 'completed' : 'blocked') : f.status;
  const dimensions = D.meta.dimensions || [];
  const sortState = new Map(), payloadPromises = new Map();
  let contextId = D.meta.default_context || C[0]?.id || '';
  let excluded = new Set(), revision = 0, detailRevision = 0, activeView = 'overview', selectedFactor = '';
  const median = values => { const a = values.filter(finite).sort((a,b)=>a-b); return a.length ? (a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2 : null; };
  const groupColor = (i,n) => { const t=n<2?0:i/(n-1), a=[168,69,47], b=[31,107,98], white=[235,233,221], from=t<.5?a:white,to=t<.5?white:b,q=t<.5?t*2:(t-.5)*2; return 'rgb('+from.map((v,k)=>Math.round(v+(to[k]-v)*q)).join(',')+')'; };
  const compatible = (a,b) => dimensions.filter(d=>!['mode','hold'].includes(d.key)).every(d=>a?.dimensions?.[d.key]===b?.dimensions?.[d.key]);
  const activeRows = () => R.filter(r => r.context_id === contextId && ($('variants').value === 'all' || r.preferred !== false));
  const factorName = id => factorMap.get(id)?.name || id;
  const rowName = r => factorMap.get(r.factor_id)?.short_name || factorName(r.factor_id);
  const rowLabel = r => rowName(r) + (r.variant ? ' · ' + r.variant : '');
  const factorLink = (id, r = {}) => `<a href="#factor=${encodeURIComponent(id)}${r.id ? '&setting=' + encodeURIComponent(r.id) : ''}">${esc(factorName(id))}</a>`;
  const displayPorts = (r, mode = $('portfolio').value) => (r.portfolios || []).filter(p => mode === 'both' || p.role === mode);

  function table(id, columns, records, defaultKey) {
    const host = $(id);
    if (!records.length) { host.innerHTML = '<p class="empty">当前设置无可用记录</p>'; return; }
    if (!sortState.has(id) && defaultKey) sortState.set(id, {key:defaultKey, asc:false});
    const sort = sortState.get(id), data = [...records];
    if (sort) data.sort((a, b) => {
      const x = a[sort.key], y = b[sort.key];
      if (x === null || x === undefined || x === '') return y === null || y === undefined || y === '' ? 0 : 1;
      if (y === null || y === undefined || y === '') return -1;
      return (finite(x) && finite(y) ? x - y : String(x).localeCompare(String(y))) * (sort.asc ? 1 : -1);
    });
    host.innerHTML = `<table${id === 'catalog' ? ' class="catalog-table"' : ''}><thead><tr>` + columns.map(([key, label]) => `<th aria-sort="${sort?.key === key ? (sort.asc ? 'ascending' : 'descending') : 'none'}"><button class="sort" data-key="${esc(key)}">${esc(label)} ${sort?.key === key ? (sort.asc ? '↑' : '↓') : '↕'}</button></th>`).join('') + '</tr></thead><tbody>' + data.map(r => '<tr>' + columns.map(([key, , format]) => '<td>' + (format ? format(r[key], r) : esc(r[key] ?? '—')) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    host.querySelectorAll('button.sort').forEach(button => button.onclick = () => {
      sortState.set(id, {key:button.dataset.key, asc:sort?.key === button.dataset.key ? !sort.asc : false});
      table(id, columns, records);
    });
  }

  function plot(id, traces, title, extra = {}) {
    const host = $(id);
    if (!traces.length) { Plotly.purge(host); host.innerHTML='<p class="empty">当前设置没有已保存的可绘制数据</p>'; return; }
    if (host.querySelector('.empty')) host.innerHTML='';
    const small=['overview-median','overview-decay','group-bars','group-volatility','factor-decay','factor-ic-dist','factor-cum-ic'].includes(id);
    Plotly.react(host,traces,{
      title:{text:title,font:{size:12}},paper_bgcolor:'rgba(0,0,0,0)',plot_bgcolor:'rgba(0,0,0,0)',
      font:{family:'Inter,Segoe UI,Microsoft YaHei,sans-serif',size:11,color:'#78857e'},
      width:Math.max(200,host.clientWidth||600),
      margin:{l:52,r:16,t:title?32:15,b:small?68:75},height:id==='factor-drawdown'?190:small?285:id==='compare'?510:360,
      hovermode:'x unified',xaxis:{gridcolor:'#e5e7df'},yaxis:{gridcolor:'#e5e7df',zerolinecolor:'#c6cbc0'},
      legend:{orientation:'h',y:-.22,x:0,font:{size:10}},...extra
    },{responsive:true,displaylogo:false,toImageButtonOptions:{format:'png',scale:2}});
  }

  function formula(text) {
    return String(text || '公式尚未提供').split(/;\s*/).map(line => '<math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><mrow>' + (line.match(/\d*\.\d+|\d+|[A-Za-zα-ωΑ-Ω][A-Za-z0-9_α-ωΑ-Ω]*|[\u4e00-\u9fff]+|[^\s]/g) || []).map(t => {
      const tag = /^\d/.test(t) ? 'mn' : /[\u4e00-\u9fff]/.test(t) ? 'mtext' : /^[A-Za-zα-ωΑ-Ω]/.test(t) ? 'mi' : 'mo';
      return `<${tag}>${esc(t)}</${tag}>`;
    }).join('') + '</mrow></math>').join('');
  }

  async function loadRow(row) {
    if (!row.payload || row.loaded) return;
    if (!payloadPromises.has(row.payload)) payloadPromises.set(row.payload, new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = row.payload;
      script.onload = () => { script.remove(); resolve(); };
      script.onerror = () => { script.remove(); payloadPromises.delete(row.payload); reject(new Error('逐日序列加载失败')); };
      document.body.appendChild(script);
    }));
    await payloadPromises.get(row.payload);
    const payload = window.SINGLE_FACTOR_PAYLOADS?.[row.payload_key];
    if (!payload) throw new Error('逐日序列内容缺失');
    for (const key of ['dates','ic_series','pearson_ic','cumulative_ic','drawdown']) if (payload[key]) row[key] = payload[key];
    for (const key of ['portfolios','groups']) for (const p of row[key] || []) {
      const series = (payload[key] || []).find(x => x.id === p.id);
      if (series) p.nav = series.nav;
    }
    row.loaded = true;
  }

  const metricColumns = [
    ['factor_id','因子',factorLink], ['variant','版本／参数'], ['portfolio','持仓'],
    ['annualized_return','年化净收益',pct], ['cagr','净CAGR',pct], ['sharpe','净Sharpe',num], ['drawdown','最大回撤',pct],
    ['cumulative_return','累计收益',pct], ['volatility','年化波动',pct], ['ic','Mean Rank IC',num],
    ['raw_ic','原Rank IC',num], ['direction','方向乘数',num], ['gross_sharpe','毛Sharpe',num],
    ['annualized_fee_rate','年化费用率',pct], ['win_rate','日胜率',pct], ['status','计算状态',statusText]
  ];
  function metrics(rows, mode) {
    return rows.flatMap(r => displayPorts(r, mode).map(p => ({...p, id:r.id, factor_id:r.factor_id, variant:r.variant,
      portfolio:p.label || p.id, ic:r.ic_mean, raw_ic:r.raw_ic, direction:r.direction_multiplier, status:calculationState(factorMap.get(r.factor_id) || {})})));
  }
  function annual(id, rows, mode) {
    const records = rows.flatMap(r => displayPorts(r, mode).filter(p => Object.keys(p.annual || {}).length).map(p => ({id:r.id, factor_id:r.factor_id, variant:r.variant, portfolio:p.label || p.id, ...p.annual})));
    const years = [...new Set(records.flatMap(r => Object.keys(r).filter(k => /^\d{4}$/.test(k))))].sort();
    table(id, [['factor_id','因子',factorLink], ['variant','版本'], ['portfolio','持仓'], ...years.map(y => [y,y,pct])], records);
  }

  function contextControls() {
    if (!dimensions.length) {
      $('context-controls').innerHTML = '<label class="field">评估设置<select id="context">' + C.map(c => `<option value="${esc(c.id)}">${esc(c.label)}</option>`).join('') + '</select></label>';
      $('context').value = contextId;
      $('context').onchange = () => setContext($('context').value);
      return;
    }
    let pool = C;
    const selected = contextMap.get(contextId)?.dimensions || {};
    $('context-controls').innerHTML = dimensions.map((d, i) => {
      const options = [...new Set(pool.map(c => c.dimensions?.[d.key] ?? '未提供'))];
      const value = selected[d.key] ?? options[0];
      pool = pool.filter(c => (c.dimensions?.[d.key] ?? '未提供') === value);
      return `<label class="field">${esc(d.label)}<select id="dimension-${i}" data-index="${i}">` + options.map(v => `<option ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('') + '</select></label>';
    }).join('');
    $('context-controls').querySelectorAll('select').forEach(select => select.onchange = () => {
      const index = Number(select.dataset.index);
      let candidates = C.filter(c => dimensions.slice(0, index + 1).every((d, j) => (c.dimensions?.[d.key] ?? '未提供') === $('dimension-' + j).value));
      for (const d of dimensions.slice(index + 1)) {
        const same = candidates.filter(c => c.dimensions?.[d.key] === selected[d.key]);
        if (same.length) candidates = same;
      }
      setContext(candidates[0]?.id || '');
    });
  }
  function setContext(id) {
    contextId = id; excluded = new Set(); contextControls();
    $('correlation-context').value = D.correlations.find(c => c.context_id === id)?.id || '';
    if(activeView==='factor'){
      const rr=activeRows(),r=rr.find(r=>r.factor_id===selectedFactor)||rr.find(r=>r.payload)||rr[0];
      if(r){location.hash='factor='+encodeURIComponent(r.factor_id)+'&setting='+encodeURIComponent(r.id);return;}
    }
    update();
  }

  function overview(rows) {
    const records=metrics(rows,'LS').filter(p=>p.active!==false&&finite(p.annualized_return));
    const points=records.filter(p=>finite(p.ic));
    $('scatter-count').textContent=rows.length+' 条设置 · '+points.length+' 个有效点';
    plot('scatter',points.length?[{x:points.map(p=>p.ic),y:points.map(p=>p.annualized_return),text:points.map(p=>factorName(p.factor_id)),customdata:points.map(p=>p.id),mode:'markers',type:'scatter',marker:{size:7,color:'#33607e'},hovertemplate:'%{text}<br>Rank IC %{x:.4f}<br>年化收益 %{y:.2%}<extra></extra>'}]:[],'',{hovermode:'closest',xaxis:{title:'Mean Rank IC',gridcolor:'#e5e7df'},yaxis:{title:'年化多空净收益',tickformat:'.0%',gridcolor:'#e5e7df'}});
    const scatter=$('scatter'); if(scatter.removeAllListeners)scatter.removeAllListeners('plotly_click');
    if(scatter.on)scatter.on('plotly_click',e=>{const r=R.find(r=>r.id===e.points[0]?.customdata);if(r)location.hash='factor='+encodeURIComponent(r.factor_id)+'&setting='+encodeURIComponent(r.id);});
    const contexts=C.filter(c=>compatible(c,contextMap.get(contextId)));
    const aggregates=contexts.map(c=>{const rr=R.filter(r=>r.context_id===c.id&&($('variants').value==='all'||r.preferred!==false));const pp=metrics(rr,'LS').filter(p=>p.active!==false);return {c,label:dimensions.length?[c.dimensions.mode,c.dimensions.hold].filter(Boolean).join(' / '):c.label,ret:median(pp.map(p=>p.annualized_return)),ic:median(rr.map(r=>r.ic_mean)),n:pp.filter(p=>finite(p.annualized_return)).length};});
    const valid=aggregates.filter(x=>finite(x.ret));
    plot('overview-median',valid.length?[{x:valid.map(x=>x.label),y:valid.map(x=>x.ret),type:'bar',customdata:valid.map(x=>x.n),marker:{color:valid.map(x=>x.ret<0?'#a8452f':'#1f6b62')},hovertemplate:'%{x}<br>中位年化收益 %{y:.2%}<br>%{customdata} 个有效设置<extra></extra>'}]:[],'',{hovermode:'closest',yaxis:{tickformat:'.0%'},xaxis:{tickangle:-25}});
    $('median-note').textContent=aggregates.length+' 个实际评估设置；分组内取已保存数值的中位数，不跨实验或阶段汇总。';
    const ic=aggregates.filter(x=>finite(x.ic));
    plot('overview-decay',ic.length?[{x:ic.map(x=>x.label),y:ic.map(x=>x.ic),type:'scatter',mode:'lines+markers',line:{color:'#33607e'}}]:[],'',{xaxis:{tickangle:-25},yaxis:{title:'Median Rank IC'}});
    $('overview-positive').textContent=pct(median(records.map(r=>r.annualized_return)));
    $('overview-metrics').innerHTML=[[records.length,'有效多空结果',String],[median(records.map(r=>r.sharpe)),'净夏普中位数',num],[median(rows.map(r=>r.ic_mean)),'Rank IC 中位数',num],[rows.filter(r=>r.payload||r.dates?.length).length,'有逐日序列',String]].map(([v,l,f])=>`<div class="metric"><small>${esc(l)}</small><b>${esc(f(v))}</b></div>`).join('');
    table('overview-table',[['factor_id','因子',factorLink],['variant','参数版本'],['annualized_return','年化净收益',pct],['ic','Rank IC',num],['sharpe','净夏普',num]],records);
  }

  async function update() {
    const ticket=++revision,context=contextMap.get(contextId),rows=activeRows();
    $('context-note').textContent=context?.description||'尚未提供评估设置';
    $('filters').innerHTML=rows.map(r=>`<label><input type="checkbox" value="${esc(r.id)}" ${excluded.has(r.id)?'':'checked'}>${esc(rowLabel(r))}</label>`).join('');
    $('filters').querySelectorAll('input').forEach(input=>input.onchange=()=>{input.checked?excluded.delete(input.value):excluded.add(input.value);update();});
    overview(rows);
    matrix();
    const shown=rows.filter(r=>!excluded.has(r.id));
    const loads=await Promise.allSettled(shown.map(loadRow));
    if(ticket!==revision)return;
    const traces=[]; let skipped=0;
    for(const r of shown)for(const p of displayPorts(r)){
      if(p.active===false||!p.nav?.length)continue;
      if($('scale').value==='log'&&p.nav.some(v=>finite(v)&&v<=0)){skipped++;continue;}
      traces.push({x:r.dates,y:p.nav,type:'scatter',mode:'lines',name:rowLabel(r)+' · '+(p.label||p.id),line:{color:color(r.factor_id),width:1.5,dash:p.role==='long'?'dot':'solid'}});
    }
    plot('compare',traces,'收益曲线总览',{uirevision:contextId+$('variants').value,yaxis:{title:'扣费净值',type:$('scale').value}});
    table('metrics',metricColumns,metrics(shown),'annualized_return');annual('annual',shown);
    const missing=rows.filter(r=>!r.payload&&!r.dates?.length).length;
    $('context-note').textContent=(context?.description||'尚未提供评估设置')+(missing?` ${missing} 条设置未保存逐日序列，按原状态展示。`:'')+(skipped?' 非正净值不适用对数轴。':'')+(loads.some(x=>x.status==='rejected')?' 部分序列加载失败，请检查报告文件。':'');
  }

  function matrix() {
    const m=D.correlations.find(c=>c.id===$('correlation-context').value);
    $('correlation-note').textContent=m?m.method:'当前设置未提供相关性结果。';
    const custom=m?.values.map((row,i)=>row.map((v,j)=>[v,m.days?.[i]?.[j]??'未提供',m.overlap?.[i]?.[j]??'未提供']));
    plot('matrix',m?[{type:'heatmap',x:m.ids,y:m.ids,z:m.values,customdata:custom,zmin:-1,zmax:1,colorscale:[[0,'#a8452f'],[.5,'#f2f1e9'],[1,'#1f6b62']],hoverongaps:false,showscale:false,hovertemplate:'%{y} × %{x}<br>ρ=%{customdata[0]:.4f}<br>有效月份=%{customdata[1]}<br>共同证券=%{customdata[2]}<extra></extra>'}]:[],'',{height:Math.max(420,Math.min(780,(m?.ids.length||0)*26+140)),hovermode:'closest',margin:{l:85,r:10,t:12,b:100},xaxis:{tickangle:-60},yaxis:{autorange:'reversed'}});
    const related=R.filter(r=>r.context_id===m?.context_id);
    const mapId=name=>related.find(r=>r.variant===name||r.factor_id===name||factorMap.get(r.factor_id)?.short_name===name);
    let index=m?.ids.findIndex(id=>mapId(id)?.factor_id===selectedFactor)??-1;if(index<0)index=0;
    $('neighbors-title').textContent=m?(m.ids[index]+' · 最相关因子'):'当前因子的相关性';
    const near=m?m.ids.map((id,j)=>({name:id,rho:m.values[index]?.[j],months:m.days?.[index]?.[j],stocks:m.overlap?.[index]?.[j],row:mapId(id)})).filter((x,j)=>j!==index&&finite(x.rho)).sort((a,b)=>Math.abs(b.rho)-Math.abs(a.rho)).slice(0,20):[];
    table('neighbors',[['name','因子',(v,r)=>r.row?factorLink(r.row.factor_id,r.row):esc(v)],['rho','ρ',num],['months','月份'],['stocks','证券数',num]],near);
  }

  function catalog() {
    const q = $('search').value.toLowerCase(), status = $('status').value, experiment = $('catalog-experiment').value;
    const factors = F.map(f => ({...f,status:calculationState(f)})).filter(f => (!status || f.status === status) && (!experiment || f.experiment === experiment) && [f.id,f.name,f.formula,f.economic_meaning].join(' ').toLowerCase().includes(q));
    $('count').textContent = `显示 ${factors.length} / ${F.length} 个因子`;
    table('catalog', [['id','因子',factorLink],['experiment','实验'],['formula','公式'],['economic_meaning','隐含经济含义（假设）'],['status','状态',statusText]], factors);
  }

  function detail(id, settingId) {
    selectedFactor=id; const f = factorMap.get(id), ticket = ++detailRevision;
    if (!f) { $('factor-title').textContent = '未找到因子'; return; }
    $('factor-search').value=f.name; $('factor-title').textContent = f.name; $('factor-status').textContent = [f.experiment, statusText(calculationState(f))].filter(Boolean).join(' · ');
    $('formula').innerHTML = formula(f.formula); $('calculation').textContent = f.calculation_method || '计算口径尚未提供';
    $('economics').textContent = f.economic_meaning || '经济含义尚未提供';
    $('missing').hidden = !f.missing_details?.length; $('missing').textContent = '定义或数据缺口：' + (f.missing_details || []).join('；');
    const rows = R.filter(r => r.factor_id === id);
    $('factor-context').innerHTML = rows.map(r => `<option value="${esc(r.id)}">${esc(contextMap.get(r.context_id)?.label || r.context_id)}${r.variant ? ' / ' + esc(r.variant) : ''}</option>`).join('');
    $('factor-context').value = rows.find(r => r.id === settingId)?.id || rows.find(r => r.context_id === contextId && r.preferred !== false)?.id || rows.find(r => r.preferred !== false && r.payload)?.id || rows.find(r => r.preferred !== false)?.id || rows[0]?.id || '';
    async function render() {
      const selectedId = $('factor-context').value, row = rows.find(r => r.id === selectedId);
      $('parameters').textContent = '因子参数：' + JSON.stringify(f.parameters || {}) + (row?.parameters ? '\n当前设置实际参数：' + JSON.stringify(row.parameters) : '');
      $('factor-note').textContent = row ? (contextMap.get(row.context_id)?.description || '已保存的评估结果') + (row.payload && !row.loaded ? ' · 正在载入…' : '') : '该候选没有已计算设置。';
      let error = false;
      if (row) try { await loadRow(row); } catch { error = true; }
      if (ticket !== detailRevision || selectedId !== $('factor-context').value) return;
      $('factor-note').textContent = row ? (contextMap.get(row.context_id)?.description || '已保存的评估结果') + ` · 原Rank IC ${num(row.raw_ic)}；方向乘数 ${num(row.direction_multiplier)}；当前Rank IC ${num(row.ic_mean)}。` + (error ? ' 逐日序列加载失败。' : !row.dates?.length ? ' 此设置未保存逐日序列。' : '') : '该候选没有已计算设置。';
      $('factor-downloads').innerHTML = links(row?.downloads || f.downloads || []);
      const ports = row?.portfolios || [], groups = row?.groups || [];
      plot('factor-nav', ports.filter(p => p.role === 'LS' && p.active !== false && p.nav?.length).map(p => ({x:row.dates,y:p.nav,type:'scatter',mode:'lines',name:p.label || p.id})), '扣费净值');
      plot('factor-drawdown', row?.drawdown?.length ? [{x:row.dates,y:row.drawdown,type:'scatter',mode:'lines',fill:'tozeroy',line:{color:'#ab4771'},name:'多空回撤'}] : [], '多空回撤', {yaxis:{tickformat:'.0%'}});
      const ic = [];
      if (row?.ic_series?.length) ic.push({x:row.dates,y:row.ic_series,type:'scatter',mode:'lines',name:'每日Rank IC',line:{color:'#087f79'}});
      if (row?.pearson_ic?.length) ic.push({x:row.dates,y:row.pearson_ic,type:'scatter',mode:'lines',name:'每日Pearson IC',visible:'legendonly'});
      plot('factor-ic', ic, '每日 IC');
      plot('factor-cum-ic', row?.cumulative_ic?.length ? [{x:row.dates,y:row.cumulative_ic,type:'scatter',mode:'lines',name:'累计Rank IC',line:{color:'#087f79'}}] : [], '累计 Rank IC');
      const bars = groups.filter(p => finite(p.annualized_return) && p.active !== false);
      plot('group-bars', bars.length ? [{x:bars.map(p => p.label || p.id),y:bars.map(p => p.annualized_return),type:'bar',marker:{color:'#087f79'}}] : [], '分组年化净收益', {hovermode:'closest',xaxis:{title:'分组'},yaxis:{tickformat:'.0%'}});
      plot('groups', groups.filter(p => p.active !== false && p.nav?.length).map((p,i) => ({x:row.dates,y:p.nav,type:'scatter',mode:'lines',name:p.label || p.id,line:{color:groupColor(i,groups.length),width:1.4}})).concat(ports.filter(p=>p.role==='LS'&&p.active!==false&&p.nav?.length).map(p=>({x:row.dates,y:p.nav,type:'scatter',mode:'lines',name:'多空',line:{color:'#17231f',width:2.6}}))), '全部分组净值');
      table('group-metrics', [['label','分组'],['annualized_return','年化净收益',pct],['cagr','净CAGR',pct],['sharpe','净Sharpe',num],['drawdown','最大回撤',pct],['gross_sharpe','毛Sharpe',num],['annualized_fee_rate','年化费用率',pct]], groups);
      annual('factor-annual', row ? [row] : [], 'both'); table('factor-metrics', metricColumns, metrics(row ? [row] : [], 'both'));
      $('group-count').textContent=groups.length+' 个已保存分组'+(ports.some(p=>p.role==='LS')?' + 多空':'');
      const ls=ports.find(p=>p.role==='LS');
      const last=ls?.active===false?null:(ls?.nav?.filter(finite).at(-1)??ls?.final_nav);
      $('factor-final-nav').textContent=finite(last)?last.toFixed(3):'—';
      $('factor-summary').innerHTML=[[ls?.annualized_return,'年化净收益',pct],[ls?.sharpe,'净夏普',num],[row?.ic_mean,'Mean Rank IC',num],[ls?.drawdown,'最大回撤',pct]].map(([v,l,f])=>`<div class="metric"><small>${esc(l)}</small><b class="${finite(v)&&v<0?'neg':''}">${f(v)}</b></div>`).join('');
      plot('group-volatility',groups.some(p=>finite(p.volatility))?[{x:groups.map(p=>p.label||p.id),y:groups.map(p=>p.volatility),type:'bar',marker:{color:groups.map((p,i)=>groupColor(i,groups.length))}}]:[],'',{hovermode:'closest',yaxis:{tickformat:'.0%'}});
      const comparisons=rows.filter(r=>r.preferred!==false&&compatible(contextMap.get(r.context_id),contextMap.get(row?.context_id))).map(r=>({r,p:r.portfolios.find(p=>p.role==='LS')})).filter(x=>finite(x.p?.annualized_return));
      plot('factor-decay',comparisons.length?[{x:comparisons.map(x=>{const c=contextMap.get(x.r.context_id);return c?.dimensions?[c.dimensions.mode,c.dimensions.hold].filter(Boolean).join(' / '):c?.label;}),y:comparisons.map(x=>x.p.annualized_return),mode:'lines+markers',type:'scatter',line:{color:'#33607e'}}]:[],'',{xaxis:{tickangle:-25},yaxis:{tickformat:'.0%'}});
      const icValues=(row?.ic_series||[]).filter(finite);
      plot('factor-ic-dist',icValues.length?[{x:icValues,type:'histogram',nbinsx:35,marker:{color:'#1f6b62'}}]:[],'',{hovermode:'closest',xaxis:{title:'Rank IC'},yaxis:{title:'日数'}});

    }
    $('factor-context').onchange = () => {location.hash='factor='+encodeURIComponent(id)+'&setting='+encodeURIComponent($('factor-context').value);}; render();
  }

  function links(downloads) { return downloads.filter(d => d.href && !/^(javascript|data):/i.test(d.href)).map(d => `<a href="${esc(d.href)}">${esc(d.label)}</a>`).join(''); }
  function sections(id, items) { $(id).innerHTML = items.length ? items.map(x => `<h3>${esc(x.title)}</h3><p class="prewrap">${esc(x.text)}</p>${x.downloads?.length ? '<div class="downloads">' + links(x.downloads) + '</div>' : ''}`).join('') : '<p class="empty">尚未提供记录</p>'; }
  function applyView() {
    document.querySelectorAll('[data-overview]').forEach(p=>p.hidden=activeView!=='overview');
    $('all').hidden=activeView!=='all';$('detail').hidden=activeView!=='factor';
    document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.view===activeView)));
    requestAnimationFrame(resizePlots);
  }
  function resizePlots() {
    document.querySelectorAll('.js-plotly-plot').forEach(p=>{
      // Plotly.purge leaves the host class behind when a setting has no series.
      if(p.clientWidth>0&&p._fullLayout&&p.layout&&p.querySelector('.main-svg'))Plotly.relayout(p,{width:p.clientWidth});
    });
  }
  function route() {
    const hash=location.hash.slice(1),params=new URLSearchParams(hash);
    ++detailRevision;
    if(params.get('factor')){
      const id=params.get('factor'),r=R.find(r=>r.id===params.get('setting'))||activeRows().find(r=>r.factor_id===id);
      if(r&&r.context_id!==contextId){contextId=r.context_id;contextControls();$('correlation-context').value=D.correlations.find(m=>m.context_id===contextId)?.id||'';}
      activeView='factor';applyView();detail(id,params.get('setting'));update();
    }else{
      activeView=['factor','all'].includes(hash)?hash:'overview';applyView();update();
      if(activeView==='factor'){
        const rr=activeRows(),r=rr.find(r=>r.factor_id===selectedFactor)||rr.find(r=>r.payload)||rr[0];
        const id=r?.factor_id||F[0]?.id;
        if(id)detail(id,r?.id);else{$('factor-title').textContent='尚未提供因子';}
      }
    }
  }

  $('title').textContent = D.meta.title || '单因子回测与检验'; document.title = $('title').textContent;
  $('source').textContent = D.meta.source || '单因子研究'; $('description').textContent = D.meta.description || '';
  $('report-note').hidden = !D.meta.note; $('report-note').textContent = D.meta.note || '';
  $('footer').textContent = D.meta.footer || '单因子研究报告 · 经济机制解释为假设';
  const counts = D.meta.statistics || [{value:F.length,label:'输入因子'},{value:new Set(R.map(r => r.factor_id)).size,label:'有结果记录'},{value:C.length,label:'评估设置'}];
  $('numbers').innerHTML = counts.map(x => `<dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd>`).join('');
  $('variant-control').hidden = !R.some(r => r.preferred === false);
  $('status').innerHTML += [...new Set(F.map(calculationState))].map(s => `<option value="${esc(s)}">${esc(statusText(s))}</option>`).join('');
  const experiments = [...new Set(F.map(f => f.experiment).filter(Boolean))];
  $('catalog-experiment-control').hidden = experiments.length < 2;
  $('catalog-experiment').innerHTML = '<option value="">全部实验</option>' + experiments.map(x => `<option>${esc(x)}</option>`).join('');
  $('correlation-context').innerHTML = '<option value="">未提供相关性设置</option>' + D.correlations.map(m => `<option value="${esc(m.id)}">${esc(contextMap.get(m.context_id)?.label || m.context_id)}</option>`).join('');
  $('correlation-context').value = D.correlations.find(m => m.context_id === contextId)?.id || '';
  $('downloads').innerHTML = links(D.downloads || []);
  sections('experiment-list', D.experiments); sections('method-content', D.method);
  if (D.notes?.length) $('research-notes').innerHTML = '<h3>' + D.notes.length + ' 条研究笔记 · 不计入因子</h3><ol>' + D.notes.map(n => `<li><strong>${esc(n.title)}</strong><p>${esc(n.text)}</p></li>`).join('') + '</ol>';
  for (const id of ['scale','portfolio','variants']) $(id).onchange = update;
  document.querySelectorAll('[data-view]').forEach((b,i,list)=>{b.onclick=()=>{location.hash=b.dataset.view==='overview'?'overview':b.dataset.view;};b.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();const n=list[(i+(e.key==='ArrowRight'?1:list.length-1))%list.length];n.focus();n.click();}};});
  $('factor-options').innerHTML=F.map(f=>`<option value="${esc(f.name)}">${esc(f.id)}</option>`).join('');
  const findFactor=()=>{const q=$('factor-search').value.trim().toLowerCase(),f=F.find(f=>f.id.toLowerCase()===q||f.name.toLowerCase()===q);if(f)location.hash='factor='+encodeURIComponent(f.id);};
  $('factor-search').onchange=findFactor;$('factor-search').onkeydown=e=>{if(e.key==='Enter')findFactor();};
  document.querySelectorAll('details').forEach(d=>d.addEventListener('toggle',()=>{if(d.open)requestAnimationFrame(resizePlots);}));
  for (const id of ['search','status','catalog-experiment']) $(id).oninput = catalog;
  $('correlation-context').onchange = matrix;
  window.addEventListener('hashchange', route);
  window.addEventListener('resize', () => requestAnimationFrame(resizePlots));
  contextControls(); catalog(); route();
})();
