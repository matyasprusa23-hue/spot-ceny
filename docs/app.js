/* global echarts, SpotAnalysis */
(function () {
  'use strict';
  var A = SpotAnalysis;
  var C = {
    text: '#f5f5f7', text2: '#a1a1a6', text3: '#6e6e73', grid: '#26262a', surface: '#161618',
    am: '#3987e5', pm: '#d95926', cheap: '#199e70', bar: '#4a4a4f', work: '#c3c2b7', weekend: '#d55181',
    y1: '#6e6e73', y2: '#f5f5f7', y3: '#3987e5'
  };
  var MONTHS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'];
  var charts = {};
  var state = { all: null, today: null, heroDate: null, dayDate: null, range: '90', ext: 14, heat: '120', when: '90' };

  // ---------- pomocné ----------
  var $ = function (id) { return document.getElementById(id); };
  var kc = function (v) { return v === null || v === undefined || isNaN(v) ? '–' : A.fmtKc(v); };
  var kwh = function (v) { return (v / 1000).toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' Kč/kWh'; };
  function pragueToday() {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: A.TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return p.slice(0, 10);
  }
  function longDate(d, withYear) {
    var p = d.split('-');
    return A.DAYS[A.weekday(d)] + ' ' + (+p[2]) + '. ' + A.MONTHS_GEN[+p[1] - 1] + (withYear ? ' ' + p[0] : '');
  }
  function shortDate(d) { var p = d.split('-'); return (+p[2]) + '. ' + (+p[1]) + '. ' + p[0]; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function chart(id) {
    if (!charts[id]) charts[id] = echarts.init($(id), null, { renderer: 'canvas' });
    return charts[id];
  }
  var base = {
    animationDuration: 500,
    textStyle: { fontFamily: '-apple-system, BlinkMacSystemFont, Inter, Segoe UI, sans-serif', color: C.text2 },
    tooltip: {
      backgroundColor: 'rgba(29,29,32,.96)', borderColor: '#3a3a3c', borderWidth: 1, padding: [10, 14],
      textStyle: { color: C.text, fontSize: 13 }, extraCssText: 'border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.5);'
    }
  };
  function axisStyle(extra) {
    return Object.assign({
      axisLine: { lineStyle: { color: C.grid } }, axisTick: { show: false },
      axisLabel: { color: C.text3, fontSize: 12 }, splitLine: { lineStyle: { color: C.grid } }
    }, extra || {});
  }
  function kcAxis(extra) {
    return axisStyle(Object.assign({ type: 'value', axisLabel: { color: C.text3, fontSize: 12, formatter: function (v) { return A.fmtKc(v); } } }, extra || {}));
  }

  // ---------- načtení ----------
  function load() {
    var year = +pragueToday().slice(0, 4);
    var years = [];
    var until = pragueToday().slice(5, 7) === '12' ? year + 1 : year;
    for (var y = 2025; y <= until; y++) years.push(y);
    return Promise.all(years.map(function (y) {
      return fetch('data/ote_' + y + '.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; });
    }).concat([fetch('data/meta.json', { cache: 'no-cache' }).then(function (r) { return r.ok ? r.json() : {}; }).catch(function () { return {}; })]))
      .then(function (res) {
        var meta = res.pop();
        return { files: res, meta: meta };
      });
  }

  // ---------- HERO ----------
  function renderHeroTabs() {
    var all = state.all, t = state.today, tm = A.addDays(t, 1);
    var tabs = [];
    if (all.byDate[t]) tabs.push({ d: t, l: 'Dnes' });
    if (all.byDate[tm]) tabs.push({ d: tm, l: 'Zítra' });
    if (!tabs.length) {
      var last = all.days[all.days.length - 1].date;
      tabs.push({ d: last, l: 'Poslední den' });
    }
    if (!state.heroDate) state.heroDate = tabs[0].d;
    $('heroTabs').innerHTML = tabs.map(function (x) {
      return '<button role="tab" data-d="' + x.d + '" class="' + (x.d === state.heroDate ? 'on' : '') + '">' + x.l + '</button>';
    }).join('');
    $('heroTabs').onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      state.heroDate = b.dataset.d; renderHeroTabs(); renderHero();
      setDay(b.dataset.d);
    };
  }
  function fillHero(id, w) {
    var el = $(id);
    el.querySelector('.window').textContent = w ? w.label : 'bez dat';
    el.querySelector('.big').textContent = w ? kc(w.czk) : '–';
    el.querySelector('.kwh').textContent = w ? '· ' + kwh(w.czk) : '';
  }
  function renderHero() {
    var d = state.all.byDate[state.heroDate];
    $('heroDate').textContent = cap(longDate(d.date));
    fillHero('heroAm', d.am); fillHero('heroPm', d.pm); fillHero('heroCheap', d.cheap);
    var notes = [];
    if (d.provisional) notes.push('Předběžný přepočet – kurz ČNB pro tento den ještě nebyl vyhlášen (použit kurz ' + shortDate(d.rateDate) + ').');
    if (!d.complete) notes.push('Neúplná data OTE pro tento den.');
    if (state.heroDate === state.today && !state.all.byDate[A.addDays(state.today, 1)]) notes.push('Ceny na zítřek OTE zveřejňuje kolem 13:00.');
    $('heroNote').textContent = notes.join(' ');
  }

  // ---------- DETAIL DNE ----------
  function setDay(date, scroll) {
    var all = state.all;
    if (!all.byDate[date]) return;
    state.dayDate = date;
    $('dayPicker').value = date;
    renderDay();
    if (scroll) $('den').scrollIntoView({ behavior: 'smooth' });
  }
  function renderDay() {
    var all = state.all, d = all.byDate[state.dayDate];
    var prev = all.days.slice(Math.max(0, d.i - 30), d.i);
    var prof = A.profile(prev.length ? prev : [d]);
    var labels = d.slots.map(function (s) { return s.hm; });
    var inW = function (w, i) { return w && i >= w.startIdx && i <= w.endIdx; };
    var data = d.slots.map(function (s, i) {
      var col = inW(d.am, i) ? C.am : inW(d.pm, i) ? C.pm : inW(d.cheap, i) ? C.cheap : C.bar;
      return { value: Math.round(s.czk * 100) / 100, itemStyle: { color: col, borderRadius: s.czk >= 0 ? [3, 3, 0, 0] : [0, 0, 3, 3] } };
    });
    var typical = d.slots.map(function (s) { var v = prof[s.hour * 4 + s.min / 15]; return v === null ? null : Math.round(v); });
    var win = function (w, name) { return w ? name + ' ' + w.label : ''; };

    $('dayStats').innerHTML = [
      ['Den', cap(longDate(d.date, true)) + (d.holiday ? ' · svátek' : '')],
      ['Průměr dne', kc(d.avg) + '<small>Kč/MWh</small>'],
      ['Minimum', kc(d.min) + '<small>' + d.minHM + '</small>'],
      ['Maximum', kc(d.max) + '<small>' + d.maxHM + '</small>'],
      ['Kurz', d.rate.toLocaleString('cs-CZ', { minimumFractionDigits: 3 }) + '<small>' + (d.provisional ? 'předběžný' : 'CZK/EUR') + '</small>']
    ].map(function (x) { return '<div class="stat"><div class="k">' + x[0] + '</div><div class="v">' + x[1] + '</div></div>'; }).join('');

    var notes = [];
    if (d.res === 60) notes.push('Do 30. 9. 2025 byl trh hodinový – každá hodina má jednu cenu.');
    if (d.hours !== 24) notes.push('Přechod letní/zimní čas: den má ' + d.hours + ' hodin.');
    if (!d.complete) notes.push('OTE pro část dne ceny nevyhlásil (4. 7. 2025 stav nouze).');
    $('dayNote').textContent = notes.join(' ');

    var every = d.res === 15 ? 7 : 1;
    chart('chartDay').setOption(Object.assign({}, base, {
      grid: { left: 64, right: 16, top: 16, bottom: 34 },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,.05)' } },
        formatter: function (ps) {
          var i = ps[0].dataIndex, s = d.slots[i];
          var end = s.endHM === '00:00' ? '24:00' : s.endHM;
          var tag = inW(d.am, i) ? '<span style="color:' + C.am + '">● nejdražší 2 h dopoledne</span>' :
            inW(d.pm, i) ? '<span style="color:' + C.pm + '">● nejdražší 2 h odpoledne</span>' :
            inW(d.cheap, i) ? '<span style="color:' + C.cheap + '">● nejlevnější 2 h</span>' : '';
          return '<b>' + s.hm + '–' + end + '</b><br>' + kc(s.czk) + ' Kč/MWh <span style="color:' + C.text3 + '">(' +
            s.eur.toLocaleString('cs-CZ') + ' €)</span>' + (typical[i] !== null ? '<br><span style="color:' + C.text3 + '">obvykle ' + kc(typical[i]) + ' Kč</span>' : '') +
            (tag ? '<br>' + tag : '');
        }
      }),
      xAxis: axisStyle({ type: 'category', data: labels, axisLabel: { color: C.text3, fontSize: 12, interval: every }, splitLine: { show: false } }),
      yAxis: kcAxis(),
      series: [
        { type: 'bar', name: 'Cena', data: data, barCategoryGap: '18%', animationDurationUpdate: 400,
          markLine: { silent: true, symbol: 'none', label: { show: false }, lineStyle: { color: C.text3, width: 1 }, data: [{ yAxis: 0 }] } },
        { type: 'line', name: 'Obvyklý průběh', data: typical, showSymbol: false, smooth: true,
          lineStyle: { color: C.text3, width: 2, type: 'dashed' }, z: 5 }
      ]
    }), true);
  }

  // ---------- VÝVOJ ----------
  function renderTrendChart() {
    var all = state.all, days = all.days.filter(function (d) { return d.date <= A.addDays(state.today, 1); });
    var am = days.map(function (d) { return d.am ? d.am.czk : null; });
    var pm = days.map(function (d) { return d.pm ? d.pm.czk : null; });
    var ma = function (arr) { return A.movingAvg(arr, 7); };
    var amMA = ma(am), pmMA = ma(pm);
    var pts = function (arr) { return days.map(function (d, i) { return [d.date, arr[i] === null ? null : Math.round(arr[i])]; }); };
    var last = days[days.length - 1].date;
    var start = state.range === 'all' ? days[0].date : A.addDays(last, -(+state.range) + 1);
    var c = chart('chartTrend');
    c.setOption(Object.assign({}, base, {
      grid: { left: 64, right: 16, top: 16, bottom: 60 },
      tooltip: Object.assign({}, base.tooltip, {
        trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: C.text3 } },
        formatter: function (ps) {
          var i = ps[0].dataIndex, d = days[i];
          return '<b>' + cap(longDate(d.date, true)) + '</b><br>' +
            '<span style="color:' + C.am + '">●</span> Dopoledne ' + (d.am ? d.am.label + ' · <b>' + kc(d.am.czk) + '</b>' : '–') + '<br>' +
            '<span style="color:' + C.pm + '">●</span> Odpoledne ' + (d.pm ? d.pm.label + ' · <b>' + kc(d.pm.czk) + '</b>' : '–') + '<br>' +
            '<span style="color:' + C.text3 + '">7denní průměr: ' + kc(amMA[i]) + ' / ' + kc(pmMA[i]) + ' Kč</span><br>' +
            '<span style="color:' + C.text3 + '">klikněte pro detail dne</span>';
        }
      }),
      xAxis: axisStyle({ type: 'time', splitLine: { show: false },
        axisLabel: { color: C.text3, fontSize: 12, hideOverlap: true, formatter: function (v) { var d = new Date(v); var s = d.getDate() + '. ' + (d.getMonth() + 1) + '.'; return d.getMonth() === 0 && d.getDate() === 1 ? d.getFullYear() + '' : s; } } }),
      yAxis: kcAxis(),
      dataZoom: [
        { type: 'inside', startValue: start, endValue: last, filterMode: 'none' },
        { type: 'slider', startValue: start, endValue: last, height: 24, bottom: 8, borderColor: 'transparent',
          backgroundColor: '#1d1d20', fillerColor: 'rgba(255,255,255,.08)', dataBackground: { lineStyle: { color: C.text3 }, areaStyle: { color: '#2a2a2e' } },
          selectedDataBackground: { lineStyle: { color: C.text2 }, areaStyle: { color: '#3a3a3c' } },
          handleStyle: { color: '#3a3a3c', borderColor: '#6e6e73' }, moveHandleStyle: { color: '#3a3a3c' },
          textStyle: { color: C.text3 }, labelFormatter: function (v) { return shortDate(new Date(v).toISOString().slice(0, 10)); } }
      ],
      series: [
        { name: 'Dopoledne', type: 'scatter', data: pts(am), symbolSize: 6, itemStyle: { color: C.am, opacity: .35 } },
        { name: 'Odpoledne', type: 'scatter', data: pts(pm), symbolSize: 6, itemStyle: { color: C.pm, opacity: .35 } },
        { name: 'Dopoledne – 7 dní', type: 'line', data: pts(amMA), showSymbol: false, smooth: .3, lineStyle: { color: C.am, width: 2.5 }, itemStyle: { color: C.am } },
        { name: 'Odpoledne – 7 dní', type: 'line', data: pts(pmMA), showSymbol: false, smooth: .3, lineStyle: { color: C.pm, width: 2.5 }, itemStyle: { color: C.pm } }
      ]
    }), true);
    c.off('click');
    c.on('click', function (p) { var d = days[p.dataIndex]; if (d) setDay(d.date, true); });
    c.getZr().off('click');
    c.getZr().on('click', function (ev) {
      if (ev.target) return;
      var pt = [ev.offsetX, ev.offsetY];
      if (!c.containPixel('grid', pt)) return;
      var v = c.convertFromPixel({ xAxisIndex: 0 }, pt[0]);
      var best = null;
      days.forEach(function (d) { if (!best || Math.abs(Date.parse(d.date) - v) < Math.abs(Date.parse(best.date) - v)) best = d; });
      if (best) setDay(best.date, true);
    });
  }

  // ---------- EXTRÉMY ----------
  function renderExtremes() {
    var x = A.extremes(state.all, lastStatDate(), state.ext);
    if (!x) { $('extGrid').innerHTML = ''; return; }
    var card = function (kind, o) {
      var d = o.day, w = o.win;
      var which = kind === 'lo' ? 'nejlevnější 2 h dne' : (w === d.am ? 'dopolední okno' : 'odpolední okno');
      return '<article class="ext">' +
        '<div class="tag ' + kind + '">' + (kind === 'hi' ? 'Nejvyšší cena' : 'Nejnižší cena') + ' · ' + state.ext + ' dní</div>' +
        '<div class="val">' + kc(w.czk) + '<small>Kč/MWh</small></div>' +
        '<div class="when"><button data-d="' + d.date + '">' + cap(longDate(d.date)) + '</button> · ' + w.label + ' <span class="muted">(' + which + ')</span></div>' +
        '<ul>' + o.reasons.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ul>' +
        '<div class="hint">Možné důvody odvozené z průběhu cen, kalendáře a sezóny.</div>' +
        '</article>';
    };
    $('extGrid').innerHTML = card('hi', x.hi) + card('lo', x.lo);
    $('extGrid').onclick = function (e) { var b = e.target.closest('button[data-d]'); if (b) setDay(b.dataset.d, true); };
  }
  function lastStatDate() { // statistiky do dneška (zítřek jen pokud dnešek chybí)
    var all = state.all;
    if (all.byDate[state.today]) return state.today;
    var cand = all.days.filter(function (d) { return d.date <= state.today; });
    return (cand.length ? cand[cand.length - 1] : all.days[all.days.length - 1]).date;
  }

  // ---------- TREND ----------
  function renderTrend() {
    var t = A.trends(state.all, lastStatDate());
    $('trendText').textContent = t.text;
    $('trendGrid').innerHTML = t.cards.map(function (c) {
      var ch = c.change, cls = Math.abs(ch) < 5 || c.unit === 'h' ? 'flat' : ch > 0 ? 'up' : 'down';
      var arrow = Math.abs(ch) < 5 ? '→' : ch > 0 ? '↑' : '↓';
      var detail = c.unit === 'h'
        ? Math.round(c.value) + ' h letos · ' + Math.round(c.prevTotal) + ' h loni'
        : kc(c.value) + ' Kč · předtím ' + kc(c.prev) + ' Kč';
      return '<div class="tcard"><div class="t">' + c.title + '</div><div class="s">' + c.sub + '</div>' +
        '<div class="chg ' + cls + '"><span class="arrow">' + arrow + '</span>' + (ch > 0 ? '+' : '') + Math.round(ch) + ' %</div>' +
        '<div class="d">' + detail + '</div></div>';
    }).join('');
  }

  // ---------- MAPA CEN ----------
  var HEAT_PIECES = [
    { lt: -500, color: '#1c5cab', label: '< −500' },
    { gte: -500, lt: 0, color: '#3987e5', label: '−500 – 0' },
    { gte: 0, lt: 1500, color: '#2a2a2e', label: '0 – 1 500' },
    { gte: 1500, lt: 2500, color: '#3e302f', label: '1 500 – 2 500' },
    { gte: 2500, lt: 3500, color: '#5c3830', label: '2 500 – 3 500' },
    { gte: 3500, lt: 4500, color: '#7f4032', label: '3 500 – 4 500' },
    { gte: 4500, lt: 6000, color: '#a64a34', label: '4 500 – 6 000' },
    { gte: 6000, lt: 8000, color: '#d05a3c', label: '6 000 – 8 000' },
    { gte: 8000, lt: 11000, color: '#ef7d63', label: '8 000 – 11 000' },
    { gte: 11000, color: '#ffc1b3', label: '> 11 000' }
  ];
  function renderHeat() {
    var all = state.all, last = lastStatDate();
    var days = all.days.filter(function (d) { return d.date <= last; });
    if (state.heat !== 'all') days = days.slice(-(+state.heat));
    var xs = [];
    for (var q = 0; q < 96; q++) xs.push((q / 4 | 0) + ':' + ('0' + (q % 4) * 15).slice(-2));
    var data = [];
    days.forEach(function (d, yi) {
      A.quarterGrid(d).forEach(function (v, xi) { if (v !== null) data.push([xi, yi, Math.round(v)]); });
    });
    var ys = days.map(function (d) { return d.date; });   // osa Y roste zdola – nejnovější den je nahoře
    var c = chart('chartHeat');
    c.setOption(Object.assign({}, base, {
      grid: { left: 86, right: 130, top: 8, bottom: 30 },
      tooltip: Object.assign({}, base.tooltip, {
        formatter: function (p) {
          var d = ys[p.value[1]];
          return '<b>' + cap(longDate(d, true)) + '</b><br>' + xs[p.value[0]] + ' · <b>' + kc(p.value[2]) + '</b> Kč/MWh';
        }
      }),
      xAxis: axisStyle({ type: 'category', data: xs, splitLine: { show: false }, axisLabel: { color: C.text3, fontSize: 12, interval: 11 } }),
      yAxis: axisStyle({ type: 'category', data: ys, inverse: false, splitLine: { show: false }, axisLine: { show: false },
        axisLabel: { color: C.text3, fontSize: 12,
          interval: function (i, v) { return v.slice(8) === '01' || (days.length <= 40 && A.weekday(v) === 1); },
          formatter: function (v) { var p = v.split('-'); return v.slice(8) === '01' ? MONTHS[+p[1] - 1] + ' ' + p[0] : (+p[2]) + '. ' + (+p[1]) + '.'; } } }),
      visualMap: { type: 'piecewise', pieces: HEAT_PIECES, orient: 'vertical', right: 0, top: 'middle', itemWidth: 14, itemHeight: 12,
        itemGap: 6, textStyle: { color: C.text2, fontSize: 12 }, inactiveColor: '#1d1d20' },
      series: [{ type: 'heatmap', data: data, progressive: 20000, animation: false,
        emphasis: { itemStyle: { borderColor: C.text, borderWidth: 1 } } }]
    }), true);
    c.off('click');
    c.on('click', function (p) { setDay(ys[p.value[1]], true); });
  }

  // ---------- KDY BÝVÁ NEJDRÁŽ ----------
  function renderWhen() {
    var last = lastStatDate(), all = state.all;
    var days = all.days.filter(function (d) { return d.date <= last; });
    if (state.when !== 'all') days = days.slice(-(+state.when));
    var am = new Array(24).fill(0), pm = new Array(24).fill(0);
    days.forEach(function (d) { if (d.am) am[d.am.startHour]++; if (d.pm) pm[d.pm.startHour]++; });
    var hrs = []; for (var h = 0; h < 24; h++) hrs.push(h + ':00');
    var z = function (arr, isAm) { return arr.map(function (v, i) { return (isAm ? i < 12 : i >= 12) ? v : null; }); };
    chart('chartWhen').setOption(Object.assign({}, base, {
      grid: { left: 40, right: 8, top: 16, bottom: 28 },
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,.05)' } },
        formatter: function (ps) {
          var i = ps[0].dataIndex, v = i < 12 ? am[i] : pm[i];
          return '<b>Začátek okna ' + i + ':00–' + i + ':59</b><br>' + v + ' dní (' + Math.round(v / days.length * 100) + ' %)';
        } }),
      xAxis: axisStyle({ type: 'category', data: hrs, splitLine: { show: false }, axisLabel: { color: C.text3, fontSize: 12, interval: 2 } }),
      yAxis: axisStyle({ type: 'value', minInterval: 1 }),
      series: [
        { type: 'bar', name: 'Dopoledne', stack: 'x', data: z(am, true), itemStyle: { color: C.am, borderRadius: [4, 4, 0, 0] }, barCategoryGap: '25%' },
        { type: 'bar', name: 'Odpoledne', stack: 'x', data: z(pm, false), itemStyle: { color: C.pm, borderRadius: [4, 4, 0, 0] } }
      ]
    }), true);
  }

  // ---------- PRACOVNÍ DNY VS VÍKEND ----------
  function renderWeek() {
    var last = lastStatDate(), all = state.all;
    var days = all.days.filter(function (d) { return d.date <= last; }).slice(-90);
    var work = A.profile(days.filter(function (d) { return !d.weekend && !d.holiday; }));
    var wk = A.profile(days.filter(function (d) { return d.weekend || d.holiday; }));
    var xs = []; for (var q = 0; q < 96; q++) xs.push((q / 4 | 0) + ':' + ('0' + (q % 4) * 15).slice(-2));
    var r = function (a) { return a.map(function (v) { return v === null ? null : Math.round(v); }); };
    chart('chartWeek').setOption(Object.assign({}, base, {
      grid: { left: 58, right: 12, top: 16, bottom: 28 },
      tooltip: Object.assign({}, base.tooltip, { trigger: 'axis', axisPointer: { type: 'line', lineStyle: { color: C.text3 } },
        formatter: function (ps) {
          var i = ps[0].dataIndex;
          return '<b>' + xs[i] + '</b><br><span style="color:' + C.work + '">●</span> Pracovní dny ' + kc(work[i]) +
            ' Kč<br><span style="color:' + C.weekend + '">●</span> Víkendy a svátky ' + kc(wk[i]) + ' Kč';
        } }),
      xAxis: axisStyle({ type: 'category', data: xs, boundaryGap: false, splitLine: { show: false }, axisLabel: { color: C.text3, fontSize: 12, interval: 11 } }),
      yAxis: kcAxis(),
      series: [
        { type: 'line', name: 'Pracovní dny', data: r(work), showSymbol: false, smooth: .3, lineStyle: { color: C.work, width: 2 }, itemStyle: { color: C.work } },
        { type: 'line', name: 'Víkendy a svátky', data: r(wk), showSymbol: false, smooth: .3, lineStyle: { color: C.weekend, width: 2 }, itemStyle: { color: C.weekend } }
      ]
    }), true);
  }

  // ---------- MĚSÍCE ----------
  function yearColors(years) {
    var pal = [C.y1, C.y2, C.y3, C.cheap];
    var out = {};
    years.forEach(function (y, i) { out[y] = pal[i % pal.length]; });
    return out;
  }
  function renderMonths() {
    var last = lastStatDate(), all = state.all;
    var days = all.days.filter(function (d) { return d.date <= last; });
    var years = [];
    days.forEach(function (d) { var y = d.date.slice(0, 4); if (years.indexOf(y) < 0) years.push(y); });
    var col = yearColors(years);
    var neg = {}, pk = {}, cnt = {};
    years.forEach(function (y) { neg[y] = new Array(12).fill(null); pk[y] = new Array(12).fill(null); cnt[y] = new Array(12).fill(0); });
    days.forEach(function (d) {
      var y = d.date.slice(0, 4), m = +d.date.slice(5, 7) - 1;
      neg[y][m] = (neg[y][m] || 0) + d.negHours;
      if (d.pm) { pk[y][m] = (pk[y][m] || 0) + d.pm.czk; cnt[y][m]++; }
    });
    years.forEach(function (y) { pk[y] = pk[y].map(function (v, m) { return cnt[y][m] ? Math.round(v / cnt[y][m]) : null; }); });
    var partial = last.slice(0, 7);
    var legend = years.map(function (y) { return '<span><i class="sw" style="background:' + col[y] + '"></i>' + y + '</span>'; }).join('') +
      '<span class="muted">' + MONTHS[+partial.slice(5) - 1] + ' ' + partial.slice(0, 4) + ' zatím neúplný</span>';
    $('negLegend').innerHTML = legend; $('monthLegend').innerHTML = legend;
    var mk = function (id, src, fmt, unit) {
      chart(id).setOption(Object.assign({}, base, {
        grid: { left: 58, right: 8, top: 16, bottom: 28 },
        tooltip: Object.assign({}, base.tooltip, { trigger: 'axis', axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(255,255,255,.05)' } },
          formatter: function (ps) {
            return '<b>' + MONTHS[ps[0].dataIndex] + '</b><br>' + ps.map(function (p) {
              return '<span style="color:' + col[p.seriesName] + '">●</span> ' + p.seriesName + ': ' + (p.value === null || p.value === undefined ? '–' : fmt(p.value) + ' ' + unit);
            }).join('<br>');
          } }),
        xAxis: axisStyle({ type: 'category', data: MONTHS, splitLine: { show: false } }),
        yAxis: id === 'chartNeg' ? axisStyle({ type: 'value' }) : kcAxis(),
        series: years.map(function (y) {
          return { type: 'bar', name: y, data: src[y], itemStyle: { color: col[y], borderRadius: [4, 4, 0, 0] }, barGap: '12%', barCategoryGap: '30%' };
        })
      }), true);
    };
    mk('chartNeg', neg, function (v) { return Math.round(v); }, 'h');
    mk('chartMonth', pk, function (v) { return kc(v); }, 'Kč/MWh');
  }

  // ---------- ovládání ----------
  function seg(id, key, cb) {
    $(id).onclick = function (e) {
      var b = e.target.closest('button'); if (!b) return;
      [].forEach.call($(id).querySelectorAll('button'), function (x) { x.classList.toggle('on', x === b); });
      state[key] = b.dataset.r || b.dataset.n;
      if (key === 'ext') state.ext = +state.ext;
      cb();
    };
  }
  function bind() {
    var all = state.all;
    $('dayPicker').min = all.days[0].date;
    $('dayPicker').max = all.days[all.days.length - 1].date;
    $('dayPicker').onchange = function () { setDay(this.value); };
    $('dayPrev').onclick = function () { var d = all.byDate[state.dayDate]; if (d.i > 0) setDay(all.days[d.i - 1].date); };
    $('dayNext').onclick = function () { var d = all.byDate[state.dayDate]; if (d.i < all.days.length - 1) setDay(all.days[d.i + 1].date); };
    seg('rangeSeg', 'range', renderTrendChart);
    seg('extSeg', 'ext', renderExtremes);
    seg('heatSeg', 'heat', renderHeat);
    seg('whenSeg', 'when', renderWhen);
    window.addEventListener('resize', function () { Object.keys(charts).forEach(function (k) { charts[k].resize(); }); });
  }

  function start() {
    load().then(function (r) {
      state.all = A.buildAll(r.files);
      if (!state.all.days.length) { $('heroDate').textContent = 'Data se nepodařilo načíst'; return; }
      state.today = pragueToday();
      renderHeroTabs(); renderHero();
      bind();
      setDay(state.heroDate);
      renderTrendChart(); renderExtremes(); renderTrend();
      renderHeat(); renderWhen(); renderWeek(); renderMonths();
      if (r.meta && r.meta.updated) {
        var u = new Date(r.meta.updated);
        $('updated').textContent = 'Data aktualizována ' + u.toLocaleString('cs-CZ', { timeZone: A.TZ, day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) + '.';
      }
    }).catch(function (e) {
      console.error(e);
      $('heroDate').textContent = 'Chyba při načítání dat';
    });
  }
  start();
})();
