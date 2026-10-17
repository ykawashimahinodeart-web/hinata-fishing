/* Pure status summaries for the optional bathymetry sources. */
(() => {
  function precisionStatus(match, datasetSelected=true) {
    if (!datasetSelected) return { label:'十分な実測データなし', detail:'精密断面に使う端末内CSVデータセットが選択されていません。' };
    if (!match) return { label:'未確認', detail:'CAST LINEの始点と方位を指定してください。' };
    if (match.segments.length) return { label:'一部区間のみ表示可能', detail:`条件を満たす実測区間 ${match.segments.length}件、測深点 ${match.points.length}点。未測定区間は線で結んでいません。` };
    if (match.points.length) return { label:'実測点あり', detail:`CAST LINE付近に実測点 ${match.points.length}点。線の接続条件を満たす区間はありません。` };
    return { label:'十分な実測データなし', detail:'現在のCAST LINEに適合する測深点はありません。' };
  }

  function csvStatus({ match, datasetCount=0, error=false }={}) {
    if (error) return { label:'読み込みエラー', detail:'端末内のCSVデータセットを読み込めませんでした。' };
    if (!datasetCount) return { label:'データなし', detail:'この端末に保存されたCSV測深データはありません。' };
    if (!match) return { label:'データセットあり・未確認', detail:`保存済み ${datasetCount}件。CAST LINEを指定すると対象地点を照合します。` };
    if (match.points.length) return { label:'対象地点付近に測深点あり', detail:`選択中のデータセットで ${match.points.length}点がCAST LINEに適合しています。` };
    return { label:'データセットはあるが対象外', detail:'選択中のデータセットに、現在のCAST LINEに適合する点はありません。' };
  }

  function gebcoStatus({ online=true, enabled=false, zoomAllowed=false, state='unverified' }={}) {
    if (!online) return { label:'通信エラー（オフライン）', detail:'オフラインのためGEBCOへの通信を確認できません。' };
    if (!enabled) return { label:'確認中（レイヤーOFF）', detail:'広域水深レイヤーをONにするとWMS応答を確認します。' };
    if (!zoomAllowed) return { label:'確認中（表示倍率外）', detail:'ズーム12以下にするとWMS画像を確認できます。' };
    if (state==='loading') return { label:'確認中', detail:'GEBCO WMSへ問い合わせています。' };
    if (state==='error') return { label:'通信エラー', detail:'GEBCO WMS画像を取得できませんでした。地図と他の機能は引き続き利用できます。' };
    if (state==='available') return { label:'利用可能（WMS応答あり）', detail:'広域画像の応答を確認しました。地点単位の測深有無・精度は確認できません。' };
    return { label:'未確認', detail:'GEBCO WMSへの通信結果はまだ確認していません。' };
  }

  window.HINATA_DEPTH_STATUS={precisionStatus,csvStatus,gebcoStatus};
})();
