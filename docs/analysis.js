/* Výpočty nad cenami OTE – bez závislosti na prohlížeči (testovatelné v Node) */
(function (root) {
  'use strict';

  var TZ = 'Europe/Prague';
  var fmtHM = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  function hm(ms) { return fmtHM.format(new Date(ms)); }

  function parseISO(d) { return { y: +d.slice(0, 4), m: +d.slice(5, 7), d: +d.slice(8, 10) }; }
  function addDays(d, n) {
    var p = parseISO(d);
    return new Date(Date.UTC(p.y, p.m - 1, p.d + n)).toISOString().slice(0, 10);
  }
  function weekday(d) { var p = parseISO(d); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); } // 0 = neděle
  function localMidnight(d) {
    var p = parseISO(d);
    var utc0 = Date.UTC(p.y, p.m - 1, p.d);
    var off = +hm(utc0).slice(0, 2);          // v 00:00 UTC je v Praze 01:00 (zima) nebo 02:00 (léto)
    return utc0 - off * 3600000;
  }

  // ---- České státní svátky ----
  var holidayCache = {};
  function easterSunday(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4,
        f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
        i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
        m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31),
        da = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(y, mo - 1, da)).toISOString().slice(0, 10);
  }
  function holidays(y) {
    if (holidayCache[y]) return holidayCache[y];
    var fixed = ['01-01', '05-01', '05-08', '07-05', '07-06', '09-28', '10-28', '11-17', '12-24', '12-25', '12-26'];
    var set = {};
    fixed.forEach(function (md) { set[y + '-' + md] = true; });
    var e = easterSunday(y);
    set[addDays(e, -2)] = true;   // Velký pátek
    set[addDays(e, 1)] = true;    // Velikonoční pondělí
    holidayCache[y] = set;
    return set;
  }
  function isHoliday(d) { return !!holidays(+d.slice(0, 4))[d]; }

  // ---- Den ----
  function bestWindow(slots, from, to, len, sign) {
    // sign = +1 hledá nejdražší, -1 nejlevnější souvislé okno uvnitř [from, to)
    var best = null;
    for (var i = from; i + len <= to; i++) {
      var s = 0;
      for (var k = 0; k < len; k++) s += slots[i + k].czk;
      var a = s / len;
      if (best === null || sign * a > sign * best.czk + 1e-9) best = { i: i, czk: a };
    }
    if (!best) return null;
    var first = slots[best.i], last = slots[best.i + len - 1];
    var end = last.endHM === '00:00' ? '24:00' : last.endHM;
    var eur = 0;
    for (var j = 0; j < len; j++) eur += slots[best.i + j].eur;
    return { from: first.hm, to: end, label: first.hm + '–' + end, startIdx: best.i, endIdx: best.i + len - 1,
             startHour: first.hour, czk: best.czk, eur: eur / len };
  }

  function mean(arr) { if (!arr.length) return null; var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; }

  function buildDay(date, e) {
    var res = e.res, mid = localMidnight(date), len = 120 / res;
    var slots = e.eur.map(function (p, i) {
      var s = mid + i * res * 60000, t = s + res * 60000;
      var h = hm(s);
      return { idx: i, start: s, hm: h, endHM: hm(t), hour: +h.slice(0, 2), min: +h.slice(3, 5), eur: p, czk: p * e.rate };
    });
    var amEnd = 0;
    while (amEnd < slots.length && slots[amEnd].hour < 12) amEnd++;
    var czk = slots.map(function (s) { return s.czk; });
    var pick = function (h0, h1) { return mean(slots.filter(function (s) { return s.hour >= h0 && s.hour < h1; }).map(function (s) { return s.czk; })); };
    var dayMin = Math.min.apply(null, czk), dayMax = Math.max.apply(null, czk);
    var minSlot = slots[czk.indexOf(dayMin)], maxSlot = slots[czk.indexOf(dayMax)];
    var nextMid = localMidnight(addDays(date, 1));
    var hours = Math.round((nextMid - mid) / 3600000);
    var wd = weekday(date);
    return {
      date: date, res: res, rate: e.rate, rateDate: e.rateDate, provisional: !!e.provisional,
      slots: slots, hours: hours, complete: slots.length * res === hours * 60,
      weekday: wd, weekend: wd === 0 || wd === 6, holiday: isHoliday(date),
      am: bestWindow(slots, 0, amEnd, len, 1),
      pm: bestWindow(slots, amEnd, slots.length, len, 1),
      cheap: bestWindow(slots, 0, slots.length, len, -1),
      avg: mean(czk), min: dayMin, max: dayMax,
      minHM: minSlot.hm, maxHM: maxSlot.hm,
      negHours: slots.filter(function (s) { return s.eur < 0; }).length * res / 60,
      night: pick(0, 5), morning: pick(6, 9), midday: pick(10, 15), evening: pick(17, 21)
    };
  }

  // Průběh dne na mřížce 96 čtvrthodin místního času (hodinová data se rozkopírují)
  function quarterGrid(day) {
    var g = new Array(96).fill(null);
    day.slots.forEach(function (s) {
      var base = s.hour * 4 + s.min / 15;
      var n = day.res / 15;
      for (var k = 0; k < n; k++) if (base + k < 96 && g[base + k] === null) g[base + k] = s.czk;
    });
    return g;
  }

  function buildAll(files) {
    var days = [];
    files.forEach(function (f) {
      Object.keys(f).forEach(function (d) {
        var e = f[d];
        if (e && e.eur && e.eur.length) days.push(buildDay(d, e));
      });
    });
    days.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var byDate = {};
    days.forEach(function (d, i) { d.i = i; byDate[d.date] = d; });
    return { days: days, byDate: byDate };
  }

  function peakOf(d) { // nejdražší ze dvou oken dne
    if (!d.am) return d.pm; if (!d.pm) return d.am;
    return d.pm.czk >= d.am.czk ? d.pm : d.am;
  }

  function median(arr) {
    var a = arr.filter(function (x) { return x !== null && !isNaN(x); }).sort(function (x, y) { return x - y; });
    if (!a.length) return null;
    var m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  // kontext pro zdůvodnění: 30 dní před daným dnem
  function context(all, day) {
    var prev = all.days.slice(Math.max(0, day.i - 30), day.i);
    if (prev.length < 7) prev = all.days.slice(day.i, day.i + 30);
    return {
      avg: median(prev.map(function (d) { return d.avg; })),
      peak: median(prev.map(function (d) { var p = peakOf(d); return p ? p.czk : null; })),
      cheap: median(prev.map(function (d) { return d.cheap.czk; })),
      middayRatio: median(prev.map(function (d) { return d.midday !== null ? d.midday / d.avg : null; })),
      min: median(prev.map(function (d) { return d.min; }))
    };
  }

  var MONTHS_GEN = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
  var DAYS = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  function pct(a, b) { return b ? (a - b) / Math.abs(b) * 100 : null; }
  function fmtKc(v) { return Math.round(v).toLocaleString('cs-CZ').replace(/ /g, ' '); }

  function reasonsHigh(all, day, win) {
    var c = context(all, day), r = [];
    var p = pct(win.czk, c.peak);
    if (p !== null && p > 15) r.push('o ' + Math.round(p) + ' % nad běžnou špičkou posledních 30 dní');
    if (win.startHour >= 16) r.push('večerní špička – slunce už nevyrábí a spotřeba domácností roste');
    else if (win.startHour >= 5 && win.startHour < 10) r.push('ranní náběh spotřeby, solární elektrárny ještě nejedou naplno');
    else if (win.startHour < 5) r.push('noční okno – přes den bylo dost levné elektřiny ze slunce');
    var ratio = day.midday !== null ? day.midday / day.avg : null;
    if (ratio !== null && c.middayRatio !== null && ratio > Math.max(0.9, c.middayRatio + 0.15))
      r.push('chyběl polední propad cen – nejspíš zataženo a málo solární výroby');
    if (c.min !== null && day.min > Math.max(c.avg || 0, c.min * 2) && day.min > 0)
      r.push('drahý byl celý den (minimum ' + fmtKc(day.min) + ' Kč) – typicky slabý vítr i slunce zároveň');
    var spike = day.max;
    if (spike > win.czk * 1.25) r.push('krátký extrém ' + fmtKc(spike) + ' Kč v ' + day.maxHM);
    var m = +day.date.slice(5, 7);
    if (m >= 11 || m <= 2) r.push('zimní poptávka – topení a svícení');
    if (!day.weekend && !day.holiday && r.length < 2) r.push('pracovní den s běžnou spotřebou průmyslu');
    return r.slice(0, 4);
  }

  function reasonsLow(all, day, win) {
    var c = context(all, day), r = [];
    if (win.czk < 0) r.push('záporná cena – v síti byl přebytek a výrobci platili za odběr');
    if (win.startHour >= 9 && win.startHour < 16) r.push('polední maximum solární výroby');
    else if (win.startHour < 6) r.push('noční útlum spotřeby');
    if (day.holiday) r.push('státní svátek – nižší spotřeba průmyslu');
    else if (day.weekend) r.push((day.weekday === 0 ? 'neděle' : 'sobota') + ' – nižší spotřeba průmyslu');
    if (c.avg !== null && day.avg < c.avg * 0.7)
      r.push('levný byl celý den (průměr ' + fmtKc(day.avg) + ' Kč) – typicky silný vítr nebo slunce');
    if (day.negHours > 0 && win.czk >= 0) r.push(day.negHours + ' h se zápornou cenou');
    var m = +day.date.slice(5, 7);
    if (m >= 4 && m <= 8 && r.length < 3) r.push('jaro/léto – dlouhé slunečné dny');
    return r.slice(0, 4);
  }


  // srovnání okna s mediánem stejného okna za posledních 30 dní a se včerejškem
  function compare(all, day, kind) {
    var w = day[kind];
    if (!w) return null;
    var prev = all.days.slice(Math.max(0, day.i - 30), day.i);
    var med = median(prev.map(function (d) { return d[kind] ? d[kind].czk : null; }));
    var yest = all.days[day.i - 1];
    var y = yest && yest[kind] ? yest[kind].czk : null;
    return {
      normal: med, normalPct: med ? pct(w.czk, med) : null, normalDays: prev.length,
      yesterday: y, yesterdayPct: y ? pct(w.czk, y) : null, yesterdayDate: yest ? yest.date : null
    };
  }

  // nejvyšší / nejnižší 2h okno v posledních n dnech (do lastDate včetně)
  function extremes(all, lastDate, n) {
    var end = all.byDate[lastDate];
    if (!end) return null;
    var sel = all.days.slice(Math.max(0, end.i - n + 1), end.i + 1);
    var hi = null, lo = null;
    sel.forEach(function (d) {
      [d.am, d.pm].forEach(function (w) { if (w && (!hi || w.czk > hi.win.czk)) hi = { day: d, win: w }; });
      if (!lo || d.cheap.czk < lo.win.czk) lo = { day: d, win: d.cheap };
    });
    if (hi) hi.reasons = reasonsHigh(all, hi.day, hi.win);
    if (lo) lo.reasons = reasonsLow(all, lo.day, lo.win);
    return { hi: hi, lo: lo, from: sel[0].date, to: sel[sel.length - 1].date, n: sel.length };
  }

  function rangeAvg(all, fromDate, toDate, fn) {
    var v = all.days.filter(function (d) { return d.date >= fromDate && d.date <= toDate; }).map(fn).filter(function (x) { return x !== null && x !== undefined; });
    return v.length ? { avg: mean(v), n: v.length } : null;
  }

  function trends(all, lastDate) {
    var out = [];
    var a14 = addDays(lastDate, -13), p14e = addDays(lastDate, -14), p14s = addDays(lastDate, -27);
    var am = function (d) { return d.am ? d.am.czk : null; }, pm = function (d) { return d.pm ? d.pm.czk : null; };
    [['Odpolední špička', pm], ['Dopolední špička', am], ['Průměrná cena dne', function (d) { return d.avg; }]].forEach(function (t) {
      var cur = rangeAvg(all, a14, lastDate, t[1]), prev = rangeAvg(all, p14s, p14e, t[1]);
      if (cur && prev) out.push({ title: t[0], sub: '14 dní vs. předchozích 14', value: cur.avg, change: pct(cur.avg, prev.avg), prev: prev.avg });
    });
    var ly = function (d) { return (+d.slice(0, 4) - 1) + d.slice(4); };
    var y30s = addDays(lastDate, -29);
    var cy = rangeAvg(all, y30s, lastDate, pm), py = rangeAvg(all, ly(y30s), ly(lastDate), pm);
    if (cy && py && py.n > 20) out.push({ title: 'Odpolední špička meziročně', sub: '30 dní vs. stejné období loni', value: cy.avg, change: pct(cy.avg, py.avg), prev: py.avg });
    var negC = rangeAvg(all, y30s, lastDate, function (d) { return d.negHours; });
    var negP = rangeAvg(all, ly(y30s), ly(lastDate), function (d) { return d.negHours; });
    if (negC && negP && negP.n > 20) out.push({ title: 'Hodiny se zápornou cenou', sub: '30 dní vs. stejné období loni', value: negC.avg * negC.n, prevTotal: negP.avg * negP.n, unit: 'h', change: pct(negC.avg * negC.n, negP.avg * negP.n) });

    // posun času špičky
    var starts = function (from, to) {
      return median(all.days.filter(function (d) { return d.date >= from && d.date <= to && d.pm; })
        .map(function (d) { return d.pm.startIdx !== undefined ? d.slots[d.pm.startIdx].hour + d.slots[d.pm.startIdx].min / 60 : null; }));
    };
    var sNow = starts(a14, lastDate), sPrev = starts(addDays(lastDate, -89), addDays(lastDate, -60));

    // slovní shrnutí
    var txt = [];
    var t0 = out[0];
    if (t0) {
      var ch = t0.change;
      if (Math.abs(ch) < 5) txt.push('Odpolední špičky jsou za poslední dva týdny zhruba stabilní (' + sign(ch) + ' %).');
      else txt.push('Odpolední špičky za poslední dva týdny ' + (ch > 0 ? 'zdražily' : 'zlevnily') + ' o ' + Math.abs(Math.round(ch)) + ' % proti předchozím dvěma týdnům.');
    }
    var yy = out.filter(function (o) { return o.title === 'Odpolední špička meziročně'; })[0];
    if (yy) txt.push('Proti stejnému období loni jsou ' + (yy.change > 0 ? 'vyšší' : 'nižší') + ' o ' + Math.abs(Math.round(yy.change)) + ' %.');
    if (sNow !== null && sPrev !== null && Math.abs(sNow - sPrev) >= 0.5)
      txt.push('Nejdražší odpolední okno začíná typicky v ' + hhmm(sNow) + ', před dvěma měsíci to bylo v ' + hhmm(sPrev) +
        (sNow < sPrev ? ' – s kratšími dny se špička posouvá dřív.' : ' – s delšími dny se špička posouvá později.'));
    else if (sNow !== null) txt.push('Nejdražší odpolední okno začíná typicky v ' + hhmm(sNow) + '.');
    var m = +lastDate.slice(5, 7);
    if (m >= 9 && m <= 11) txt.push('Na podzim obvykle ubývá levné polední elektřiny ze slunce a ceny postupně rostou.');
    else if (m >= 3 && m <= 5) txt.push('Na jaře přibývá solární výroby – rostou polední propady a záporné ceny.');
    return { cards: out, text: txt.join(' ') };
  }
  function sign(v) { return (v > 0 ? '+' : '') + Math.round(v); }
  function hhmm(h) { var H = Math.floor(h), M = Math.round((h - H) * 60 / 15) * 15; if (M === 60) { H++; M = 0; } return H + ':' + (M < 10 ? '0' : '') + M; }

  function movingAvg(values, n) {
    var out = [];
    for (var i = 0; i < values.length; i++) {
      var s = 0, c = 0;
      for (var k = Math.max(0, i - n + 1); k <= i; k++) if (values[k] !== null) { s += values[k]; c++; }
      out.push(c >= Math.min(n, 3) ? s / c : null);
    }
    return out;
  }

  function profile(days) { // průměr po čtvrthodinách
    var sum = new Array(96).fill(0), cnt = new Array(96).fill(0);
    days.forEach(function (d) {
      quarterGrid(d).forEach(function (v, i) { if (v !== null) { sum[i] += v; cnt[i]++; } });
    });
    return sum.map(function (s, i) { return cnt[i] ? s / cnt[i] : null; });
  }

  var api = {
    TZ: TZ, hm: hm, addDays: addDays, weekday: weekday, isHoliday: isHoliday, easterSunday: easterSunday,
    buildDay: buildDay, buildAll: buildAll, compare: compare, quarterGrid: quarterGrid, peakOf: peakOf, extremes: extremes,
    trends: trends, movingAvg: movingAvg, profile: profile, median: median, mean: mean,
    reasonsHigh: reasonsHigh, reasonsLow: reasonsLow, fmtKc: fmtKc, MONTHS_GEN: MONTHS_GEN, DAYS: DAYS
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpotAnalysis = api;
})(this);
