/* Pure CSV validation. This module never stores data or contacts a service. */
(() => {
  const MAX_BYTES = 5 * 1024 * 1024;
  const MAX_POINTS = 20000;
  const MAX_ERRORS = 50;
  const aliases = {
    latitude: ['latitude'], longitude: ['longitude'], depth_m: ['depth_m'],
    measured_at: ['measured_at'], device: ['device', 'instrument'], source: ['source'],
    vertical_datum: ['vertical_datum'], horizontal_accuracy_m: ['horizontal_accuracy_m'],
    depth_accuracy_m: ['depth_accuracy_m']
  };

  function readCsv(text) {
    const records = [];
    let row = [], field = '', quoted = false, closedQuote = false, line = 1, rowLine = 1;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (ch === '"') { quoted = false; closedQuote = true; }
        else { field += ch; if (ch === '\n') line++; }
        continue;
      }
      if (closedQuote && ch !== ',' && ch !== '\r' && ch !== '\n' && ch !== ' ' && ch !== '\t') {
        throw new Error(`行${line}: 閉じ引用符の後に不正な文字があります。`);
      }
      if (ch === '"') {
        if (field.trim()) throw new Error(`行${line}: 引用符の位置が不正です。`);
        field = ''; quoted = true; closedQuote = false;
      } else if (ch === ',') {
        row.push(field.trim()); field = ''; closedQuote = false;
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field.trim()); records.push({line:rowLine, values:row});
        row = []; field = ''; closedQuote = false; line++; rowLine = line;
      } else {
        field += ch;
      }
    }
    if (quoted) throw new Error(`行${rowLine}: CSVの引用符が閉じられていません。`);
    if (field.length || row.length) { row.push(field.trim()); records.push({line:rowLine, values:row}); }
    return records;
  }

  function parse(text, fileName = 'depth.csv') {
    const errors = [], warnings = [];
    if (typeof text !== 'string' || !text.trim()) return {ok:false, errors:['CSVが空です。'], warnings, points:[]};
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) return {ok:false, errors:['ファイルは5MB以下にしてください。'], warnings, points:[]};
    if (text.includes('\uFFFD')) return {ok:false, errors:['UTF-8として読み取れない文字が含まれています。UTF-8で保存し直してください。'], warnings, points:[]};
    let records;
    try { records = readCsv(text.replace(/^\uFEFF/, '')); }
    catch (error) { return {ok:false, errors:[error.message], warnings, points:[]}; }
    if (!records.length) return {ok:false, errors:['CSVにヘッダー行がありません。'], warnings, points:[]};
    const header = records[0].values.map(value => value.trim().toLowerCase());
    const columns = {};
    Object.entries(aliases).forEach(([name, names]) => {
      columns[name] = header.findIndex(value => names.includes(value));
    });
    const missingHeaders = ['latitude','longitude','depth_m'].filter(name => columns[name] < 0);
    if (missingHeaders.length) return {ok:false, errors:[`必須列がありません: ${missingHeaders.join(', ')}`], warnings, points:[]};
    const seen = new Set(), points = [], datums = new Set();
    const rows = records.slice(1).filter(record => record.values.some(value => value !== ''));
    if (rows.length > MAX_POINTS) return {ok:false, errors:[`測深点は${MAX_POINTS.toLocaleString()}件以下にしてください。`], warnings, points:[]};
    const addError = message => { if (errors.length < MAX_ERRORS) errors.push(message); };
    rows.forEach(({line, values}) => {
      if (values.length !== header.length) { addError(`行${line}: 列数がヘッダーと一致しません。`); return; }
      const required = ['latitude','longitude','depth_m'];
      if (required.some(name => columns[name] >= values.length || values[columns[name]] === '')) {
        addError(`行${line}: 緯度・経度・水深のいずれかが欠測です。`); return;
      }
      const latitude = Number(values[columns.latitude]), longitude = Number(values[columns.longitude]), depthM = Number(values[columns.depth_m]);
      if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) { addError(`行${line}: latitude は-90〜90の数値にしてください。`); return; }
      if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) { addError(`行${line}: longitude は-180〜180の数値にしてください。`); return; }
      if (!Number.isFinite(depthM) || depthM < 0 || depthM > 12000) { addError(`行${line}: depth_m は0〜12,000の数値にしてください。`); return; }
      const optional = name => columns[name] < 0 ? '' : (values[columns[name]] || '');
      const measuredAt = optional('measured_at');
      if (measuredAt && !Number.isFinite(Date.parse(measuredAt))) { addError(`行${line}: measured_at を日付として解釈できません。`); return; }
      const horizontalRaw = optional('horizontal_accuracy_m'), depthRaw = optional('depth_accuracy_m');
      const horizontalAccuracyM = horizontalRaw === '' ? null : Number(horizontalRaw);
      const depthAccuracyM = depthRaw === '' ? null : Number(depthRaw);
      if ((horizontalAccuracyM !== null && (!Number.isFinite(horizontalAccuracyM) || horizontalAccuracyM < 0)) || (depthAccuracyM !== null && (!Number.isFinite(depthAccuracyM) || depthAccuracyM < 0))) {
        addError(`行${line}: 精度は0以上の数値にしてください。`); return;
      }
      const verticalDatum = optional('vertical_datum').trim() || '不明';
      datums.add(verticalDatum);
      const source = optional('source').trim() || fileName;
      const key = [latitude.toFixed(7), longitude.toFixed(7), depthM.toFixed(3), measuredAt].join('|');
      if (seen.has(key)) { warnings.push(`行${line}: 同一の座標・水深・測定日時の重複点を除外しました。`); return; }
      seen.add(key);
      points.push({ latitude, longitude, depth_m:depthM, measured_at:measuredAt || null,
        device:optional('device').trim() || null, source, vertical_datum:verticalDatum,
        horizontal_accuracy_m:horizontalAccuracyM, depth_accuracy_m:depthAccuracyM,
        quality_status:'measured', missing:false, source_row:line });
    });
    if (datums.size > 1) addError('同じCSVに異なる鉛直基準が含まれています。基準面ごとにファイルを分けてください。');
    if (!points.length && !errors.length) addError('有効な測深点がありません。');
    return {ok:errors.length === 0, errors, warnings, points, metadata:{verticalDatum:datums.values().next().value || '不明', sources:[...new Set(points.map(point=>point.source))], rows:rows.length}};
  }

  window.HINATA_DEPTH_DATA = { parse, MAX_BYTES, MAX_POINTS };
})();
