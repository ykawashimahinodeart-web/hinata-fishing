// Rule-based fishing conditions. These values are configurable independently of the UI.
window.HINATA_VERDICT_RULES = Object.freeze({
  windStop: 15, gustStop: 20, waveStop: 3, rainStop: 15,
  windPoor: 9, wavePoor: 1.5, windFair: 5, waveFair: 0.8,
  rainPoorProbability: 70,
  // Conservative generic defaults: select D if thunder is forecast; venue-specific rules are future work.
});

window.HinataVerdict = (() => {
  const rules = window.HINATA_VERDICT_RULES;
  const grades = {
    A: { icon: '🔥', title: '行け！', cls: 'go' },
    B: { icon: '👍', title: '悪くない！', cls: 'ok' },
    C: { icon: '🤔', title: '微妙…', cls: 'maybe' },
    D: { icon: '🛑', title: '今日はやめとけ。', cls: 'stop' },
  };
  function evaluate(hour) {
    const wind = Number.isFinite(hour.wind) ? hour.wind : null;
    const gust = Number.isFinite(hour.gust) ? hour.gust : null;
    const wave = Number.isFinite(hour.wave) ? hour.wave : null;
    const rain = Number.isFinite(hour.rain) ? hour.rain : null;
    const precip = Number.isFinite(hour.precipProbability) ? hour.precipProbability : null;
    const code = Number.isFinite(hour.code) ? hour.code : null;
    const known = [];
    let penalty = 0;
    if (wind !== null) { known.push('wind'); if (wind >= rules.windStop) return result('D', `強風（${wind.toFixed(1)}m/s）の予報。安全を優先してください。`); if (wind >= rules.windPoor) penalty += 2; else if (wind >= rules.windFair) penalty += 1; }
    if (gust !== null) { known.push('gust'); if (gust >= rules.gustStop) return result('D', `最大瞬間風速 ${gust.toFixed(1)}m/sの予報。釣行は見合わせてください。`); if (gust >= 15) penalty += 1; }
    if (wave !== null) { known.push('wave'); if (wave >= rules.waveStop) return result('D', `波高 ${wave.toFixed(1)}mの予報。海には近づかないでください。`); if (wave >= rules.wavePoor) penalty += 2; else if (wave >= rules.waveFair) penalty += 1; }
    if (rain !== null) { known.push('rain'); if (rain >= rules.rainStop) return result('D', `降水量 ${rain.toFixed(1)}mm/hの予報。釣行を見合わせてください。`); if (rain >= 5) penalty += 2; else if (rain > 0) penalty += 1; }
    if (precip !== null) { known.push('precipProbability'); if (precip >= rules.rainPoorProbability) penalty += 1; }
    if (code !== null) { known.push('code'); if (code >= 95) return result('D', '雷雨の予報。安全のため釣行を見合わせてください。'); if (code >= 80) penalty += 2; else if (code >= 51) penalty += 1; }
    if (!known.length) return { grade: null, title: '判定できません', icon: 'ℹ️', reason: '気象データを取得できません。数値を正常値として扱わず、現地情報を確認してください。', known };
    const grade = known.length < 3 ? (penalty >= 3 ? 'C' : 'B') : penalty >= 4 ? 'C' : penalty >= 2 ? 'B' : 'A'; // incomplete data cannot receive the best grade
    const reasons = [];
    if (wind !== null) reasons.push(`風 ${wind.toFixed(1)}m/s${gust !== null ? `（瞬間 ${gust.toFixed(1)}m/s）` : ''}`);
    if (wave !== null) reasons.push(`波 ${wave.toFixed(1)}m`);
    if (rain !== null) reasons.push(`雨 ${rain.toFixed(1)}mm/h`); else if (precip !== null) reasons.push(`降水確率 ${Math.round(precip)}%`);
    if (known.length < 4) reasons.push('一部データ欠測');
    return { ...grades[grade], grade, reason: reasons.join('・') + '。現地の状況も確認してください。', known };
  }
  function result(grade, reason) { return { ...grades[grade], grade, reason, known: [] }; }
  return { evaluate };
})();
